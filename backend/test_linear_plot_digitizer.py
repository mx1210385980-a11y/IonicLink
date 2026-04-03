from pathlib import Path

from PIL import Image, ImageDraw

from utils.linear_plot_digitizer import (
    PlotBox,
    collect_color_points,
    fit_line,
    pixel_slope_to_data_slope,
    split_parallel_series,
)


def _red_mask(r: int, g: int, b: int) -> bool:
    return r > 200 and r > g + 30 and r > b + 30


def test_split_parallel_series_recovers_two_red_slopes(tmp_path: Path):
    image = Image.new("RGB", (260, 220), "white")
    draw = ImageDraw.Draw(image)
    plot = PlotBox(x0=20, y0=20, x1=220, y1=180)
    draw.rectangle((plot.x0, plot.y0, plot.x1, plot.y1), outline="black", width=1)

    # Lower and upper red fit lines in pixel space.
    lower = [(40, 150), (90, 132), (140, 115), (190, 97)]
    upper = [(40, 128), (90, 102), (140, 77), (190, 52)]

    draw.line(lower, fill=(255, 0, 0), width=3)
    draw.line(upper, fill=(255, 96, 96), width=3)

    image_path = tmp_path / "dual_red_plot.png"
    image.save(image_path)

    points = collect_color_points(
        Image.open(image_path),
        plot,
        _red_mask,
        ignore_upper_fraction=0.0,
        x_margin=5,
    )
    lower_points, upper_points = split_parallel_series(points, initial_slope=-0.45)

    lower_slope_px, _ = fit_line(lower_points)
    upper_slope_px, _ = fit_line(upper_points)

    recovered = sorted(
        [
            pixel_slope_to_data_slope(lower_slope_px, plot_box=plot, x_range=250.0, y_range=60.0),
            pixel_slope_to_data_slope(upper_slope_px, plot_box=plot, x_range=250.0, y_range=60.0),
        ]
    )

    assert 0.10 <= recovered[0] <= 0.13
    assert 0.15 <= recovered[1] <= 0.18
