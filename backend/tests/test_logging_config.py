from __future__ import annotations

import logging

from logging_config import setup_logging


def test_setup_logging_updates_root_and_handler_levels(monkeypatch) -> None:
    root_logger = logging.getLogger()
    original_handlers = list(root_logger.handlers)
    original_level = root_logger.level
    handler = logging.StreamHandler()
    handler.setLevel(logging.NOTSET)
    root_logger.handlers = [handler]

    try:
        monkeypatch.setenv("LOG_LEVEL", "DEBUG")

        setup_logging()

        assert root_logger.level == logging.DEBUG
        assert handler.level == logging.DEBUG
        assert logging.getLogger("sqlalchemy.engine").level == logging.WARNING
        assert logging.getLogger("aiosqlite").level == logging.WARNING
    finally:
        root_logger.handlers = original_handlers
        root_logger.setLevel(original_level)


def test_setup_logging_falls_back_to_info_for_unknown_level(monkeypatch) -> None:
    root_logger = logging.getLogger()
    original_handlers = list(root_logger.handlers)
    original_level = root_logger.level
    root_logger.handlers = [logging.StreamHandler()]

    try:
        monkeypatch.setenv("LOG_LEVEL", "not-a-real-level")

        setup_logging()

        assert root_logger.level == logging.INFO
    finally:
        root_logger.handlers = original_handlers
        root_logger.setLevel(original_level)
