"""Single-writer durable accounting and no-retry transport underneath Inspect."""

import asyncio
import contextvars
import json
import os
import time
from decimal import Decimal as D
from pathlib import Path

import httpx
from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageUser,
    GenerateConfig,
    Model,
    ModelAPI,
    ModelOutput,
    ModelUsage,
    modelapi,
)

from .design import JSON_INSTRUCTION, MODELS, canonical, digest, validate_temperature

ENDPOINT = "https://api.tokenfactory.nebius.com/v1/chat/completions"
CONTEXT = contextvars.ContextVar("gamefield_request")
FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "action",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"action": {"type": "string", "enum": ["X", "Y"]}},
            "required": ["action"],
            "additionalProperties": False,
        },
    },
}
DRAFT = (
    "Develop a private draft for the requested decision. A separate request "
    "will produce the final action. Do not change the game objective or information."
)


class GlobalStop(RuntimeError):
    pass


class ProtocolFailure(ValueError):
    pass


def money(value):
    value = D(str(value))
    if not value.is_finite() or value < 0:
        raise ValueError("Invalid money")
    return value


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Ledger:
    def __init__(self, path: Path, cap):
        self.path, self.cap = path, money(cap)
        self.spent, self.reserved = D(0), D(0)
        self.pending, self.sent = {}, set()
        self.sequence, self.previous = 0, "0" * 64
        self.stream = path.open("x", buffering=1)
        fsync_directory(path.parent)

    def event(self, event, **data):
        row = {
            "schemaVersion": 1,
            "sequence": self.sequence,
            "previous": self.previous,
            "event": event,
            **data,
        }
        row["sha256"] = digest(row)
        self.stream.write(canonical(row).decode() + "\n")
        self.stream.flush()
        os.fsync(self.stream.fileno())
        self.previous, self.sequence = row["sha256"], self.sequence + 1
        return row

    def reserve_joint(self, entries):
        if len({key for key, _ in entries}) != len(entries):
            raise GlobalStop("Duplicate joint reservation")
        amounts = [(key, money(value)) for key, value in entries]
        if any(key in self.pending or key in self.sent for key, _ in amounts):
            raise GlobalStop("Duplicate request")
        total = sum((value for _, value in amounts), D(0))
        if self.spent + self.reserved + total > self.cap:
            raise GlobalStop("Inference allocation exhausted")
        self.event("joint-reservation", entries={k: str(v) for k, v in amounts})
        self.pending.update(amounts)
        self.reserved += total

    def before_send(self, key, body):
        if key not in self.pending or key in self.sent:
            raise GlobalStop("Unreserved or repeated transmission")
        self.event("request-sent", key=key, request=body)
        self.sent.add(key)

    def settle(self, key, response, price):
        self.event("response-received", key=key, response=response)
        usage = response.get("usage")
        if not isinstance(usage, dict) or any(
            type(usage.get(k)) is not int or usage[k] < 0
            for k in ("prompt_tokens", "completion_tokens")
        ):
            raise GlobalStop("Unknown usage; reservation retained")
        amount = (
            usage["prompt_tokens"] * money(price["inputRate"])
            + usage["completion_tokens"] * money(price["outputRate"])
        ) / 1_000_000
        reserved = self.pending[key]
        self.event("settled", key=key, costUsd=str(amount), reservationUsd=str(reserved))
        del self.pending[key]
        self.reserved -= reserved
        self.spent += amount
        if amount > reserved or self.spent + self.reserved > self.cap:
            raise GlobalStop("Provider charge exceeded conservative reservation")

    def release_unsent(self, keys):
        entries = {k: self.pending[k] for k in keys if k in self.pending and k not in self.sent}
        if entries:
            self.event("released-unsent", entries={k: str(v) for k, v in entries.items()})
            for key, amount in entries.items():
                self.reserved -= amount
                del self.pending[key]

    def close(self):
        self.stream.close()


def read_events(path):
    previous = "0" * 64
    rows = []
    with Path(path).open() as stream:
        for i, line in enumerate(stream):
            row = json.loads(line)
            sha = row.pop("sha256")
            if row["sequence"] != i or row["previous"] != previous or digest(row) != sha:
                raise ValueError("Ledger chain is corrupt")
            row["sha256"] = sha
            rows.append(row)
            previous = sha
    return rows


def request_body(messages, arm, phase, draft=None, draft_tokens=1024, *, temperature=1):
    validate_temperature(temperature)
    messages = [dict(m) for m in messages]
    if phase == "draft":
        messages[0]["content"] = messages[0]["content"].replace(JSON_INSTRUCTION, DRAFT)
    elif draft is not None:
        messages += [
            {"role": "assistant", "content": draft},
            {"role": "user", "content": "Now provide the requested final JSON action."},
        ]
    body = {
        "model": arm["model"],
        "messages": messages,
        "temperature": temperature,
        "top_p": 1,
        "max_tokens": draft_tokens if phase == "draft" else 128,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": phase == "draft"},
    }
    if phase == "action":
        body["response_format"] = FORMAT
    return body


def reservation(body, price, extra_bytes=0):
    # Byte-based conservative envelope, including extra JSON escaping of reused drafts.
    count = len(canonical(body["messages"])) + 2048 + extra_bytes
    return (
        count * money(price["inputRate"]) + body["max_tokens"] * money(price["outputRate"])
    ) / 1_000_000


def strict_json(raw):
    def pairs(items):
        result = {}
        for k, v in items:
            if k in result:
                raise ProtocolFailure("Duplicate JSON key")
            result[k] = v
        return result

    try:
        obj = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, TypeError) as error:
        raise ProtocolFailure("Invalid final JSON") from error
    if not isinstance(obj, dict) or set(obj) != {"action"} or obj["action"] not in ("X", "Y"):
        raise ProtocolFailure("Invalid final action schema")
    return obj["action"]


def validate_response(response, phase, limit):
    try:
        choices = response["choices"]
        if len(choices) != 1:
            raise ProtocolFailure("Require one choice")
        choice = choices[0]
        finish = choice["finish_reason"]
        if finish not in (("stop", "length") if phase == "draft" else ("stop",)):
            raise ProtocolFailure("Unexpected finish reason")
        message = choice["message"]
        content = message.get("content") or ""
        reasoning = message.get("reasoning_content", message.get("reasoning")) or ""
        if not isinstance(content, str) or not isinstance(reasoning, str):
            raise ProtocolFailure("Unexpected content type")
        usage = response["usage"]
        if usage["completion_tokens"] > limit:
            raise GlobalStop("Completion allowance violated")
        details = usage.get("completion_tokens_details") or {}
        reasoning_tokens = details.get("reasoning_tokens", 0)
        if type(reasoning_tokens) is not int or reasoning_tokens < 0:
            raise GlobalStop("Invalid reasoning usage")
        if phase == "draft":
            if not content and not reasoning:
                raise ProtocolFailure("Empty draft")
            draft = json.dumps(
                {"privateDraft": reasoning, "draftText": content}, ensure_ascii=False
            )
            if len(draft.encode()) > 32768:
                raise GlobalStop("Draft exceeds frozen reuse envelope")
            return draft
        if reasoning or reasoning_tokens:
            raise ProtocolFailure("Thinking-off reasoning exposed")
        return strict_json(content)
    except (KeyError, TypeError, IndexError) as error:
        raise ProtocolFailure("Malformed provider response") from error


@modelapi("gamefield")
class AuditedAPI(ModelAPI):
    """Inspect has no access to credentials or unreserved transport."""

    def __init__(self, model_name, gateway):
        super().__init__(model_name)
        self.gateway = gateway

    def should_retry(self, ex):
        return False

    async def generate(self, input, tools, tool_choice, config):
        key, body, deadline = CONTEXT.get()
        if (
            tools
            or body["model"] != self.model_name
            or config.temperature != body["temperature"]
            or body["temperature"] != self.gateway.temperature
        ):
            raise GlobalStop("Unexpected Inspect request")
        raw = await self.gateway.transmit(key, body, deadline)
        # Keep malformed responses in the authoritative ledger; validation runs after settlement.
        text = json.dumps(raw, ensure_ascii=False)
        usage = raw["usage"]
        return ModelOutput(
            model=self.model_name,
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(content=text, model=self.model_name),
                    stop_reason="stop",
                )
            ],
            usage=ModelUsage(
                input_tokens=usage["prompt_tokens"],
                output_tokens=usage["completion_tokens"],
                total_tokens=usage["prompt_tokens"] + usage["completion_tokens"],
            ),
            metadata={"raw": raw},
        )


class Gateway:
    def __init__(
        self, ledger, prices, deadline, transport=None, wall_deadline=None, *, temperature=1
    ):
        self.temperature = validate_temperature(temperature)
        if len(prices) != 2 or {p["model"] for p in prices} != set(MODELS):
            raise ValueError("Require both exact model price records")
        self.ledger, self.prices, self.deadline = ledger, {p["model"]: p for p in prices}, deadline
        self.transport, self.halted = transport, None
        self.wall_deadline = wall_deadline
        self.semaphore = asyncio.Semaphore(8)
        self.models = {
            m: Model(
                AuditedAPI(m, self),
                GenerateConfig(
                    max_retries=0,
                    max_connections=8,
                    adaptive_connections=False,
                    cache=False,
                    temperature=self.temperature,
                    top_p=1,
                ),
            )
            for m in MODELS
        }

    def check(self):
        if (
            self.halted
            or time.monotonic() >= self.deadline
            or (self.wall_deadline is not None and time.time() >= self.wall_deadline)
        ):
            raise GlobalStop(self.halted or "Dispatch deadline reached")

    def stop(self, reason):
        if self.halted is None:
            self.halted = str(reason)
            self.ledger.event("global-stop", reason=self.halted)

    def reserve_round(self, decisions):
        self.check()
        entries = []
        for key, messages, arm, draft_tokens in decisions:
            price = self.prices[arm["model"]]
            if arm["procedure"] == "draft":
                entries.append(
                    (
                        key + "/draft",
                        reservation(
                            request_body(
                                messages,
                                arm,
                                "draft",
                                draft_tokens=draft_tokens,
                                temperature=self.temperature,
                            ),
                            price,
                        ),
                    )
                )
            entries.append(
                (
                    key + "/action",
                    reservation(
                        request_body(messages, arm, "action", temperature=self.temperature),
                        price,
                        # Maximum admitted draft is 32KiB, JSON escaping can expand it 6x.
                        6 * 32768 + 512 if arm["procedure"] == "draft" else 0,
                    ),
                )
            )
        self.ledger.reserve_joint(entries)
        return [key for key, _ in entries]

    async def transmit(self, key, body, deadline):
        async with self.semaphore:
            self.check()
            remaining = min(deadline, self.deadline) - time.monotonic()
            if self.wall_deadline is not None:
                remaining = min(remaining, self.wall_deadline - time.time())
            if remaining <= 0:
                raise GlobalStop("Decision deadline reached")
            if reservation(body, self.prices[body["model"]]) > self.ledger.pending[key]:
                raise GlobalStop("Request exceeds its pre-reserved envelope")
            self.ledger.before_send(key, body)
            started = time.monotonic()
            try:
                async with asyncio.timeout(remaining):
                    if self.transport is not None:
                        raw = await self.transport(body)
                    else:
                        async with httpx.AsyncClient(
                            timeout=remaining,
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
                                    self.ledger.event(
                                        "http-failure", key=key, status=response.status_code
                                    )
                                    raise GlobalStop("Provider HTTP failure; no retry")
                                raw = json.loads(data)
                self.ledger.settle(key, raw, self.prices[body["model"]])
                self.ledger.event("request-timing", key=key, seconds=time.monotonic() - started)
                return raw
            except BaseException as error:
                self.stop(f"{type(error).__name__}: request unresolved or accounting failed")
                raise GlobalStop(self.halted) from error

    async def call(self, key, body, deadline):
        self.check()
        ctx = CONTEXT.set((key, body, deadline))
        try:
            messages = [ChatMessageSystem(content=body["messages"][0]["content"])]
            messages += [
                ChatMessageUser(content=m["content"])
                if m["role"] == "user"
                else ChatMessageAssistant(content=m["content"])
                for m in body["messages"][1:]
            ]
            output = await self.models[body["model"]].generate(
                messages,
                tools=[],
                cache=False,
                config=GenerateConfig(
                    max_retries=0,
                    max_tokens=body["max_tokens"],
                    temperature=self.temperature,
                    top_p=1,
                ),
            )
            return output.metadata["raw"]
        finally:
            CONTEXT.reset(ctx)

    async def decide(self, messages, arm, key, draft_tokens=1024):
        deadline = min(self.deadline, time.monotonic() + 600)
        draft = None
        if arm["procedure"] == "draft":
            body = request_body(
                messages, arm, "draft", draft_tokens=draft_tokens, temperature=self.temperature
            )
            raw = await self.call(key + "/draft", body, deadline)
            draft = validate_response(raw, "draft", draft_tokens)
        body = request_body(messages, arm, "action", draft, temperature=self.temperature)
        raw = await self.call(key + "/action", body, deadline)
        return validate_response(raw, "action", 128)
