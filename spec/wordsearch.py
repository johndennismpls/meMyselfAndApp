#!/usr/bin/env python3
"""Word Search Generator - generates a word search grid and PDF."""

import argparse
import datetime
import random
import re
import string
import sys

DIRECTIONS = [(0, 1), (1, 0), (1, 1)]  # horizontal, vertical, diagonal (TL->BR)


def is_ascii(text):
    return all(ord(ch) < 128 for ch in text)


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("rows", type=int)
    parser.add_argument("cols", type=int)
    parser.add_argument("terms")
    parser.add_argument("--seed", dest="seed", default=None)
    parser.add_argument("--pdf", action="store_true")
    parser.add_argument("--fontSize", type=int, default=16)
    return parser.parse_args()


def parse_seed(seed_str):
    """Returns a validated positive-integer seed, or None if not provided."""
    if seed_str is None:
        return None
    try:
        seed_int = int(seed_str)
    except ValueError:
        print("Error: Seed must be a positive integer", file=sys.stderr)
        sys.exit(1)
    seed_int = abs(seed_int)
    if seed_int == 0:
        seed_int = 1
    return seed_int


def clean_words(raw_terms):
    """Splits, strips non-alpha chars, uppercases, drops empties, dedupes."""
    words = []
    seen = set()
    for raw_word in raw_terms.split(","):
        cleaned = re.sub(r"[^A-Za-z]", "", raw_word).upper()
        if not cleaned:
            continue
        if cleaned in seen:
            continue
        seen.add(cleaned)
        words.append(cleaned)
    return words


def find_candidates(rows, cols, word_len):
    candidates = []
    for dr, dc in DIRECTIONS:
        end_row_offset = dr * (word_len - 1)
        end_col_offset = dc * (word_len - 1)
        for r in range(rows):
            if not (0 <= r + end_row_offset < rows):
                continue
            for c in range(cols):
                if not (0 <= c + end_col_offset < cols):
                    continue
                candidates.append((r, c, (dr, dc)))
    return candidates


def try_place_word(grid_letters, grid_occupants, word, word_idx, rows, cols):
    candidates = find_candidates(rows, cols, len(word))
    random.shuffle(candidates)

    for row, col, (dr, dc) in candidates:
        valid = True
        shared_with = {}
        for i, ch in enumerate(word):
            r = row + dr * i
            c = col + dc * i
            existing = grid_letters[r][c]
            if existing is None:
                continue
            if existing != ch:
                valid = False
                break
            for other_idx, other_dir in grid_occupants[r][c]:
                if other_dir == (dr, dc):
                    valid = False
                    break
                shared_with[other_idx] = shared_with.get(other_idx, 0) + 1
                if shared_with[other_idx] > 1:
                    valid = False
                    break
            if not valid:
                break
        if not valid:
            continue

        for i, ch in enumerate(word):
            r = row + dr * i
            c = col + dc * i
            grid_letters[r][c] = ch
            grid_occupants[r][c].append((word_idx, (dr, dc)))
        return True

    return False


def generate_grid(rows, cols, words):
    grid_letters = [[None for _ in range(cols)] for _ in range(rows)]
    grid_occupants = [[[] for _ in range(cols)] for _ in range(rows)]

    placement_order = list(enumerate(words))
    random.shuffle(placement_order)

    for word_idx, word in placement_order:
        placed = try_place_word(grid_letters, grid_occupants, word, word_idx, rows, cols)
        if not placed:
            print(f'Warning: Could not place word "{word}" — skipped.', file=sys.stderr)

    for r in range(rows):
        for c in range(cols):
            if grid_letters[r][c] is None:
                grid_letters[r][c] = random.choice(string.ascii_uppercase)

    return grid_letters


def generate_pdf_filename():
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"wordsearch_{timestamp}.pdf"


def write_pdf(grid_letters, words, seed_value, seed_provided, font_size, filename):
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfbase.pdfmetrics import stringWidth
        from reportlab.pdfgen import canvas
    except ImportError:
        print(
            "Warning: ReportLab not installed. PDF generation skipped. "
            "Install with: pip install reportlab",
            file=sys.stderr,
        )
        return

    rows = len(grid_letters)
    cols = len(grid_letters[0]) if rows else 0

    grid_font_size = font_size * 0.92
    wordbank_font_size = font_size * 0.83
    seed_font_size = font_size * 0.75

    grid_font = "Courier"
    text_font = "Helvetica"

    page_width, page_height = letter
    margin_x = 1.5 * 72
    margin_y = 1.0 * 72
    content_width = page_width - 2 * margin_x

    try:
        c = canvas.Canvas(filename, pagesize=letter)

        # --- Letter grid ---
        row_strings = [" ".join(row) for row in grid_letters]
        line_height = grid_font_size * 1.3
        grid_height = rows * line_height
        y = page_height - margin_y

        c.setFont(grid_font, grid_font_size)
        for row_str in row_strings:
            row_width = stringWidth(row_str, grid_font, grid_font_size)
            x = (page_width - row_width) / 2
            c.drawString(x, y, row_str)
            y -= line_height

        # --- Word bank ---
        if words:
            sorted_words = sorted(words)
            longest = max(len(w) for w in sorted_words)
            col_padding = 30
            min_col_width = stringWidth("A" * longest, text_font, wordbank_font_size) + col_padding
            num_cols = max(1, min(len(sorted_words), int(content_width // min_col_width)))
            col_width = content_width / num_cols
            word_line_height = wordbank_font_size * 1.6

            y -= line_height * 0.5  # gap between grid and word bank
            wordbank_top = y

            c.setFont(text_font, wordbank_font_size)
            for idx, word in enumerate(sorted_words):
                col = idx % num_cols
                row = idx // num_cols
                x = margin_x + col * col_width
                wy = wordbank_top - row * word_line_height
                c.drawString(x, wy, word)

            num_rows = (len(sorted_words) + num_cols - 1) // num_cols
            y = wordbank_top - num_rows * word_line_height

        # --- Seed info ---
        if seed_provided:
            seed_text = f"Seed: {seed_value}"
            c.setFont(text_font, seed_font_size)
            seed_width = stringWidth(seed_text, text_font, seed_font_size)
            x = (page_width - seed_width) / 2
            c.drawString(x, margin_y * 0.5, seed_text)

        c.save()
    except (OSError, IOError) as e:
        print(f"Warning: Could not write PDF file. {e}", file=sys.stderr)


def main():
    args = parse_args()

    if args.rows <= 0 or args.cols <= 0:
        print("Error: ROWS and COLS must be positive integers", file=sys.stderr)
        sys.exit(1)

    if not is_ascii(args.terms):
        print("Error: Non-ASCII characters detected in input.", file=sys.stderr)
        sys.exit(1)

    seed_provided = args.seed is not None
    seed_value = parse_seed(args.seed)

    if seed_value is not None:
        random.seed(seed_value)

    words = clean_words(args.terms)

    grid_letters = generate_grid(args.rows, args.cols, words)

    if args.pdf:
        filename = generate_pdf_filename()
        write_pdf(grid_letters, words, seed_value, seed_provided, args.fontSize, filename)


if __name__ == "__main__":
    main()
