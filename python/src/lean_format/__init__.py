from ._lean_format import LeanParseError, decode, encode

dumps = encode
loads = decode

__all__ = ["encode", "decode", "dumps", "loads", "LeanParseError"]
