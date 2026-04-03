from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable

from PIL import Image


PixelMask = Callable[[int, int, int], bool]


@dataclass(frozen=True)
class PlotBox:
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return max(1, self.x1 - self.x0)

    @property
    def height(self) -> int:
        return max(1, self.y1 - self.y0)


def detect_plot_box(image: Image.Image) -> PlotBox:
    rgb = image.convert("RGB")
    width, height = rgb.size

    def _dark(pixel: tuple[int, int, int]) -> bool:
        return all(channel < 180 for channel in pixel)

    col_counts = [
        sum(1 for y in range(height) if _dark(rgb.getpixel((x, y))))
        for x in range(width)
    ]
    x0 = max(range(width), key=lambda idx: col_counts[idx])

    row_counts = [
        (
            y,
            sum(1 for x in range(width) if _dark(rgb.getpixel((x, y)))),
        )
        for y in range(int(height * 0.35), height)
    ]
    y1 = max(row_counts, key=lambda item: item[1])[0]

    ys = [y for y in range(y1 + 1) if _dark(rgb.getpixel((x0, y)))]
    y0 = min(ys) if ys else 0

    axis_xs = [
        x for x in range(width)
        if _dark(rgb.getpixel((x, y1)))
    ]
    x1 = max(axis_xs) if axis_xs else width - 1

    return PlotBox(x0=x0, y0=y0, x1=x1, y1=y1)


def collect_color_points(
    image: Image.Image,
    plot_box: PlotBox,
    pixel_mask: PixelMask,
    *,
    ignore_upper_fraction: float = 0.0,
    x_margin: int = 0,
) -> list[tuple[float, float]]:
    rgb = image.convert("RGB")
    y_min = int(plot_box.y0 + plot_box.height * max(0.0, ignore_upper_fraction))
    points: list[tuple[float, float]] = []
    for x in range(plot_box.x0 + x_margin, plot_box.x1):
        for y in range(y_min, plot_box.y1):
            r, g, b = rgb.getpixel((x, y))
            if pixel_mask(r, g, b):
                points.append((float(x), float(y)))
    return points


def fit_line(points: Iterable[tuple[float, float]]) -> tuple[float, float]:
    pts = list(points)
    if len(pts) < 2:
        raise ValueError("at least two points are required")

    n = float(len(pts))
    sx = sum(x for x, _ in pts)
    sy = sum(y for _, y in pts)
    sxx = sum(x * x for x, _ in pts)
    sxy = sum(x * y for x, y in pts)
    denom = n * sxx - sx * sx
    if abs(denom) < 1e-9:
        raise ValueError("degenerate line fit")
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


def split_parallel_series(
    points: list[tuple[float, float]],
    *,
    initial_slope: float,
    iterations: int = 30,
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    if len(points) < 4:
        raise ValueError("insufficient points to split into two series")

    intercept_values = [y - initial_slope * x for x, y in points]
    mu_low = min(intercept_values)
    mu_high = max(intercept_values)

    lower: list[tuple[tuple[float, float], float]] = []
    upper: list[tuple[tuple[float, float], float]] = []
    for _ in range(iterations):
        lower = []
        upper = []
        for point, intercept in zip(points, intercept_values):
            if abs(intercept - mu_low) <= abs(intercept - mu_high):
                lower.append((point, intercept))
            else:
                upper.append((point, intercept))
        mu_low = sum(intercept for _, intercept in lower) / max(1, len(lower))
        mu_high = sum(intercept for _, intercept in upper) / max(1, len(upper))

    lower_points = [point for point, _ in lower]
    upper_points = [point for point, _ in upper]
    if not lower_points or not upper_points:
        raise ValueError("failed to separate color family into two trends")
    return lower_points, upper_points


def pixel_slope_to_data_slope(
    slope_px: float,
    *,
    plot_box: PlotBox,
    x_range: float,
    y_range: float,
) -> float:
    x_scale = x_range / float(plot_box.width)
    y_scale = y_range / float(plot_box.height)
    return -slope_px * (y_scale / x_scale)
