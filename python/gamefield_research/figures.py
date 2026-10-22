"""Static report figures from settled estimates only."""

from pathlib import Path


def render(report, directory):
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    directory = Path(directory)
    fig, ax = plt.subplots(figsize=(7, 3.5), layout="constrained")
    ax.axvline(0, color="#777777", linewidth=1)
    for i, contrast in enumerate(report["primaryContrasts"]):
        estimate = contrast["estimate"]
        interval = contrast["approximateInterval95"]
        if estimate is not None:
            if interval:
                ax.hlines(i, *interval, color="#1a6b72", linewidth=2)
            ax.plot(estimate, i, "o", color="#1a6b72")
        else:
            ax.text(0.02, i, "Insufficient completed blocks", transform=ax.get_yaxis_transform())
    ax.set_yticks([0, 1], ["Nano", "Super"])
    ax.set_ylim(-0.5, 1.5)
    ax.set_xlabel("Draft minus direct normalised oracle loss (negative favours draft)")
    ax.set_title(
        f"{report['execution']} / {report['purpose']}\n"
        "Estimates; approximate 95% intervals shown only when eligible",
        fontsize=11,
    )
    fig.savefig(directory / "primary-contrasts.svg", metadata={"Date": None})
    fig.savefig(directory / "primary-contrasts.png", dpi=160)
    plt.close(fig)
