"""Render the final report's figures from its verified numeric package."""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import numpy as np  # noqa: E402
from matplotlib import pyplot as plt  # noqa: E402


def render(directory):
    summary = json.loads((directory / "summary.json").read_text())
    plt.rcParams["svg.hashsalt"] = summary["specSha256"]
    ds = json.loads((directory / "diagnostics.json").read_text())
    target = directory / "figures"
    target.mkdir(exist_ok=True)
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})

    def save(fig, name):
        for suffix in ("png", "svg"):
            fig.savefig(
                target / f"{name}.{suffix}",
                dpi=180,
                bbox_inches="tight",
                metadata={"Date": None} if suffix == "svg" else None,
            )
            if suffix == "svg":
                path = target / f"{name}.svg"
                path.write_text(
                    "\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n"
                )
        plt.close(fig)

    fig, ax = plt.subplots(figsize=(7.8, 3.4), layout="constrained")
    rows = [c for c in summary["contrasts"] if c["family"] == "primary"]
    for y, r in enumerate(rows):
        v, (lo, hi) = r["estimate"], r["interval"]
        ax.errorbar(v, y, xerr=[[v - lo], [hi - v]], fmt="o", capsize=5, color="#126f73")
    ax.set_yticks(
        range(4), [f"{r['model'].title()} · temperature {r['temperature']}" for r in rows]
    )
    ax.axvline(0, color="#777777", linewidth=1)
    ax.invert_yaxis()
    ax.set_xlabel("Draft − Direct mean normalised benchmark loss")
    ax.set_title("Draft lowers pooled loss in all four planned comparisons", loc="left", pad=14)
    ax.text(
        0.01,
        -0.3,
        "Approximate 98.75% stratified block-bootstrap intervals · 48 matched blocks",
        transform=ax.transAxes,
        fontsize=9,
    )
    save(fig, "primary-results")

    fig, axes = plt.subplots(1, 2, figsize=(9, 6.3), layout="constrained", sharey=True)
    for t, ax in enumerate(axes):
        rows = [r for r in ds["conditions"] if r["temperature"] == t]
        values = np.array([[r["nanoEffect"], r["superEffect"]] for r in rows])
        im = ax.imshow(values, cmap="RdBu_r", vmin=-0.75, vmax=0.75, aspect="auto")
        ax.set_yticks(range(len(rows)), [r["condition"] for r in rows])
        ax.set_xticks([0, 1], ["Nano", "Super"])
        ax.set_title(f"Temperature {t}")
        for i in range(len(rows)):
            for j in range(2):
                ax.text(
                    j,
                    i,
                    f"{values[i, j]:+.2f}",
                    ha="center",
                    va="center",
                    color="white" if abs(values[i, j]) > 0.48 else "#202020",
                    fontsize=9,
                )
    fig.colorbar(im, ax=axes, label="Draft − Direct loss (blue favours Draft)", shrink=0.7)
    fig.suptitle("Opponent and horizon matter: all 16 conditions", fontsize=13)
    save(fig, "condition-effects")

    fig, axes = plt.subplots(1, 2, figsize=(8.8, 3.6), layout="constrained", sharey=True)
    for t, ax in enumerate(axes):
        for j, arm in enumerate(("nano-direct", "nano-draft", "super-direct", "super-draft")):
            row = next(
                r
                for r in summary["cooperation"]
                if r["temperature"] == t and r["cell"] == f"B/{arm}/{arm}"
            )
            ax.bar(
                j,
                100 * row["episodeWeightedCC"],
                color="#177f80" if arm.endswith("direct") else "#dd8746",
            )
        ax.set_xticks(range(4), ["Nano\nDirect", "Nano\nDraft", "Super\nDirect", "Super\nDraft"])
        ax.set_title(f"Temperature {t}")
        ax.set_ylim(0, 33)
    axes[0].set_ylabel("Mean within-episode mutual cooperation (%)")
    fig.suptitle("Autonomous self-play: less cooperation with Draft", fontsize=13)
    save(fig, "autonomous-self-play")


if __name__ == "__main__":
    render(Path(sys.argv[1]))
