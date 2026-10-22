"""Successor-only transport: durable attempts, bounded retries and response replay.

The historical no-retry gateway is deliberately unchanged. A valid recorded
completion is always replayed, including when a crash preceded settlement.
"""

import asyncio
import fcntl
import json
import os
import time
from decimal import Decimal as D

import httpx

from .gateway import (
    ENDPOINT,
    Gateway,
    GlobalStop,
    Ledger,
    fsync_directory,
    money,
    read_events,
    request_body,
    reservation,
)

POLICY = {
    "version": "audited-recovery/1",
    "maximumAttempts": 3,
    "backoffSeconds": [2, 5],
    "retryHttpStatuses": [429, 500, 502, 503, 504],
    "retryTransportErrors": True,
    "unknownChargePolicy": "retain full reservation for every transmitted attempt",
    "successfulResponsePolicy": "reuse first recorded 200; never retry invalid content or usage",
    "decisionSeconds": 600,
    "retryExposureUsd": {"engineering": "0.05", "final": "0.50"},
}


class AttemptFailure(Exception):
    def __init__(self, reason, retryable):
        super().__init__(reason)
        self.retryable = retryable


class RecoveryLedger(Ledger):
    """An append-only, locked ledger whose entire accounting state is replayable."""

    def __init__(self, path, cap, retry_cap, resume=False):
        self.path, self.cap, self.retry_cap = path, money(cap), money(retry_cap)
        self.spent = self.reserved = self.retry_exposure = D(0)
        self.pending, self.sent = {}, set()
        self.sequence, self.previous = 0, "0" * 64
        self.attempts, self.responses, self.requests, self.failures = {}, {}, {}, {}
        self.settled, self.http, self.logical = set(), {}, {}
        self.rows = []
        self.violation = None
        self.stream = path.open("r+" if resume else "x+", buffering=1)
        try:
            fcntl.flock(self.stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if resume:
                # Reject even a valid JSON record without its final newline. Never truncate.
                data = self.stream.read()
                if not data or not data.endswith("\n"):
                    raise ValueError(
                        "Incomplete ledger tail; preserve it for explicit reconciliation"
                    )
                rows = read_events(path)
                for row in rows:
                    self._apply(row)
                self.rows = rows
                self.sequence, self.previous = len(rows), rows[-1]["sha256"]
                self.stream.seek(0, os.SEEK_END)
                if (
                    self.violation
                    or self.spent + self.reserved > self.cap
                    or self.retry_exposure > self.retry_cap
                ):
                    raise GlobalStop("Replayed accounting exceeds the frozen policy; no resume")
            else:
                fsync_directory(path.parent)
        except BaseException:
            self.stream.close()
            raise

    def event(self, event, **data):
        row = super().event(event, **data)
        self._apply(row)
        self.rows.append(row)
        return row

    def _apply(self, row):
        kind = row["event"]
        if kind == "joint-reservation":
            for key, amount in row["entries"].items():
                if key in self.attempts:
                    raise ValueError("Duplicate attempt reservation")
                meta = row["attempts"][key]
                self.attempts[key] = meta
                self.logical.setdefault(meta["logicalKey"], []).append(key)
                self.pending[key] = money(amount)
                self.reserved += money(amount)
                if meta["number"] > 1:
                    self.retry_exposure += money(amount)
        elif kind == "request-sent":
            key = row["key"]
            if key not in self.pending or key in self.sent:
                raise ValueError("Invalid repeated or unreserved send")
            self.sent.add(key)
            self.requests[key] = row["request"]
        elif kind == "response-received":
            key = row["key"]
            if key not in self.sent or key in self.responses:
                raise ValueError("Invalid repeated response")
            self.responses[key] = row["response"]
        elif kind == "settled":
            key = row["key"]
            if key not in self.responses or key in self.settled:
                raise ValueError("Invalid settlement")
            self.spent += money(row["costUsd"])
            self.reserved -= self.pending.pop(key)
            self.settled.add(key)
        elif kind == "http-response":
            self.http[row["key"]] = row
        elif kind == "attempt-failed":
            self.failures[row["key"]] = row
        elif kind == "released-unsent":
            for key in row["entries"]:
                if key in self.sent:
                    raise ValueError("Cannot release a transmitted reservation")
                self.reserved -= self.pending.pop(key)
        elif kind == "accounting-overrun":
            self.violation = row["reason"]

    def reserve_attempts(self, entries):
        # entries = [(logical request, amount, original decision deadline), ...]
        amounts, metadata = {}, {}
        retry = D(0)
        for logical, amount, deadline in entries:
            number = len(self.logical.get(logical, [])) + 1
            key = f"{logical}/attempt-{number}"
            if key in amounts or number > POLICY["maximumAttempts"]:
                raise GlobalStop("Attempt limit exhausted")
            amount = money(amount)
            amounts[key] = str(amount)
            metadata[key] = {
                "logicalKey": logical,
                "number": number,
                "decisionDeadlineUnix": deadline,
            }
            if number > 1:
                retry += amount
        total = sum(map(money, amounts.values()), D(0))
        if self.spent + self.reserved + total > self.cap:
            raise GlobalStop("Inference allocation exhausted")
        if self.retry_exposure + retry > self.retry_cap:
            raise GlobalStop("Retry exposure allocation exhausted")
        self.event("joint-reservation", entries=amounts, attempts=metadata)
        return list(amounts)

    def before_send(self, key, body):
        if key not in self.pending or key in self.sent:
            raise GlobalStop("Unreserved or repeated transmission")
        self.event("request-sent", key=key, request=body)

    def settle(self, key, response, price):
        if key not in self.responses:
            self.event("response-received", key=key, response=response)
        elif self.responses[key] != response:
            raise GlobalStop("Recorded response changed")
        if key in self.settled:
            return
        usage = response.get("usage")
        if not isinstance(usage, dict) or any(
            type(usage.get(k)) is not int or usage[k] < 0
            for k in ("prompt_tokens", "completion_tokens")
        ):
            raise GlobalStop("Unknown usage; reservation retained and no new completion allowed")
        amount = (
            usage["prompt_tokens"] * money(price["inputRate"])
            + usage["completion_tokens"] * money(price["outputRate"])
        ) / 1_000_000
        reserved = self.pending[key]
        self.event("settled", key=key, costUsd=str(amount), reservationUsd=str(reserved))
        if amount > reserved or self.spent + self.reserved > self.cap:
            self.event(
                "accounting-overrun",
                key=key,
                reason="Provider charge exceeded conservative reservation",
            )
            raise GlobalStop(
                "Provider charge exceeded conservative reservation; actual usage retained"
            )

    def release_unsent(self, keys):
        # Keep unsent phases reserved across a crash; their logical identity stays fixed.
        # They are released only after a permanently invalid episode, by abandon_unsent.
        return

    def abandon_unsent(self, keys):
        entries = {
            k: str(self.pending[k]) for k in keys if k in self.pending and k not in self.sent
        }
        if entries:
            self.event("released-unsent", entries=entries)


class RecoveryGateway(Gateway):
    def check(self):
        super().check()
        if self.ledger.violation:
            raise GlobalStop(self.ledger.violation)

    def reserve_round(self, decisions):
        self.check()
        entries = []
        for key, messages, arm, tokens in decisions:
            price = self.prices[arm["model"]]
            for phase in ["draft", "action"] if arm["procedure"] == "draft" else ["action"]:
                logical = key + "/" + phase
                if logical in self.ledger.logical:
                    continue
                amount = reservation(
                    request_body(messages, arm, phase, draft_tokens=tokens),
                    price,
                    6 * 32768 + 512 if phase == "action" and arm["procedure"] == "draft" else 0,
                )
                deadline = min(time.time() + POLICY["decisionSeconds"], self.wall_deadline)
                entries.append((logical, amount, deadline))
        return self.ledger.reserve_attempts(entries) if entries else []

    def _record_failure(self, key, reason, retryable):
        meta = self.ledger.attempts[key]
        delay = POLICY["backoffSeconds"][min(meta["number"] - 1, 1)]
        self.ledger.event(
            "attempt-failed",
            key=key,
            reason=reason,
            retryable=retryable,
            nextEligibleUnix=time.time() + delay,
        )

    def _replay(self, key, body):
        if self.ledger.requests.get(key) != body:
            raise GlobalStop("Request differs from its recorded observation or draft")
        if key not in self.ledger.responses:
            http = self.ledger.http.get(key)
            if http and http["status"] == 200:
                # The raw HTTP response was durable before parsing/settlement.
                try:
                    response = json.loads(http["responseBody"])
                except (ValueError, TypeError) as error:
                    raise GlobalStop("Recorded 200 is malformed; no replacement allowed") from error
                self.ledger.event("response-received", key=key, response=response)
            else:
                return None
        raw = self.ledger.responses[key]
        self.ledger.settle(key, raw, self.prices[body["model"]])
        return raw

    async def _send(self, key, body, seconds):
        self.ledger.before_send(key, body)
        started = time.monotonic()
        async with asyncio.timeout(seconds):
            if self.transport is not None:
                raw = await self.transport(body)
            else:
                async with httpx.AsyncClient(
                    timeout=seconds,
                    follow_redirects=False,
                    trust_env=False,
                    transport=httpx.AsyncHTTPTransport(retries=0),
                ) as client:
                    async with client.stream(
                        "POST",
                        ENDPOINT,
                        json=body,
                        headers={"Authorization": "Bearer " + os.environ["NEBIUS_API_KEY"]},
                    ) as response:
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > 16_000_000:
                                raise GlobalStop("Response body guard exceeded")
                        self.ledger.event(
                            "http-response",
                            key=key,
                            status=response.status_code,
                            responseBody=data.decode("utf-8", errors="replace"),
                        )
                        if response.status_code != 200:
                            raise AttemptFailure(
                                f"HTTP {response.status_code}",
                                response.status_code in POLICY["retryHttpStatuses"],
                            )
                        try:
                            raw = json.loads(data)
                        except ValueError as error:
                            raise GlobalStop("Malformed HTTP 200; no retry") from error
            self.ledger.settle(key, raw, self.prices[body["model"]])
        self.ledger.event("request-timing", key=key, seconds=time.monotonic() - started)
        return raw

    async def transmit(self, logical, body, deadline):
        async with self.semaphore:
            while True:
                key = self.ledger.logical[logical][-1]
                meta = self.ledger.attempts[key]
                if key in self.ledger.sent:
                    raw = self._replay(key, body)
                    if raw is not None:
                        return raw
                    if key not in self.ledger.failures:
                        http = self.ledger.http.get(key)
                        retryable = http is None or http["status"] in POLICY["retryHttpStatuses"]
                        self._record_failure(key, "Unresolved transmission recovered", retryable)
                if key in self.ledger.failures:
                    failure = self.ledger.failures[key]
                    if not failure["retryable"] or meta["number"] >= POLICY["maximumAttempts"]:
                        raise GlobalStop(
                            "Request attempt policy exhausted; preserve unresolved exposure"
                        )
                    self.check()
                    seconds = min(meta["decisionDeadlineUnix"], self.wall_deadline) - time.time()
                    delay = max(0, failure["nextEligibleUnix"] - time.time())
                    if seconds <= delay:
                        raise GlobalStop("Original decision deadline reached; no reset on resume")
                    await asyncio.sleep(delay)
                    self.check()
                    self.ledger.reserve_attempts(
                        [
                            (
                                logical,
                                reservation(body, self.prices[body["model"]]),
                                meta["decisionDeadlineUnix"],
                            )
                        ]
                    )
                    continue
                self.check()
                remaining = min(
                    meta["decisionDeadlineUnix"] - time.time(),
                    self.wall_deadline - time.time(),
                    self.deadline - time.monotonic(),
                )
                if remaining <= 0:
                    raise GlobalStop("Original decision deadline reached")
                if reservation(body, self.prices[body["model"]]) > self.ledger.pending[key]:
                    raise GlobalStop("Request exceeds its pre-reserved envelope")
                try:
                    return await self._send(key, body, remaining)
                except AttemptFailure as error:
                    self._record_failure(key, str(error), error.retryable)
                except (httpx.TransportError, TimeoutError) as error:
                    self._record_failure(key, type(error).__name__, True)


def projected_engineering_events(ledger):
    """Existing technical summariser sees accepted responses under logical keys."""
    rows = []
    for row in ledger.rows:
        if "key" in row and row["key"] in ledger.attempts:
            row = {**row, "key": ledger.attempts[row["key"]]["logicalKey"]}
        rows.append(row)
    return rows
