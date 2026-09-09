"""짧게 소유하는 민감 응답 바이트용 쓰기 가능 메모리.

OS 잠금에 성공한 전용 버퍼만 사용한다. JSON이 만든 Python ``str``이나 urllib/TLS 내부
복사본은 이 경계가 소유하지 않는다.
"""

from __future__ import annotations

import ctypes
import json
import mmap
import os
from typing import Any, BinaryIO

_INITIAL_CAPACITY = 4 * 1024
_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
_LIBC = ctypes.CDLL(None, use_errno=True) if os.name != "nt" else None
_KERNEL32 = ctypes.WinDLL("kernel32", use_last_error=True) if os.name == "nt" else None


class SecureMemoryError(RuntimeError):
    """민감 응답용 쓰기 가능 메모리를 안전하게 처리할 수 없다."""


def _native_call(name: str, address: int, length: int) -> bool:
    if _KERNEL32 is not None:
        function = getattr(_KERNEL32, "VirtualLock" if name == "mlock" else "VirtualUnlock")
    else:
        function = getattr(_LIBC, name, None)
    if function is None:
        return False
    function.argtypes = (ctypes.c_void_p, ctypes.c_size_t)
    function.restype = ctypes.c_int
    result = function(address, length)
    return result != 0 if _KERNEL32 is not None else result == 0


def _address(buffer: mmap.mmap | bytearray) -> int:
    return ctypes.addressof(ctypes.c_char.from_buffer(buffer))


def _lock_region(buffer: mmap.mmap) -> bool:
    return _native_call("mlock", _address(buffer), len(buffer))


def _unlock_region(buffer: mmap.mmap) -> None:
    _native_call("munlock", _address(buffer), len(buffer))


def _wipe_region(buffer: mmap.mmap | bytearray) -> None:
    if len(buffer) == 0:
        return
    address = _address(buffer)
    explicit_bzero = getattr(_LIBC, "explicit_bzero", None)
    if explicit_bzero is not None:
        explicit_bzero.argtypes = (ctypes.c_void_p, ctypes.c_size_t)
        explicit_bzero.restype = None
        explicit_bzero(address, len(buffer))
    else:
        ctypes.memset(address, 0, len(buffer))


def _exclude_from_dump(mapping: mmap.mmap) -> bool:
    advice = getattr(mmap, "MADV_DONTDUMP", None)
    if advice is None or not hasattr(mapping, "madvise"):
        return False
    try:
        mapping.madvise(advice)
    except (OSError, ValueError):
        return False
    return True


class SensitiveBuffer:
    """전용 anonymous mmap. 잠금 실패 시 원문을 읽기 전에 중단한다."""

    def __init__(self, capacity: int):
        if capacity < 1:
            raise ValueError("capacity must be positive")
        self._mapping: mmap.mmap | None = mmap.mmap(-1, capacity, access=mmap.ACCESS_WRITE)
        self.locked = _lock_region(self._mapping)
        self.dump_excluded = _exclude_from_dump(self._mapping)
        if not self.locked:
            self.close()
            raise SecureMemoryError("sensitive memory lock unavailable")

    def view(self, length: int | None = None) -> memoryview:
        if self._mapping is None:
            raise ValueError("buffer is closed")
        return memoryview(self._mapping)[:length]

    def wipe(self) -> None:
        if self._mapping is not None:
            _wipe_region(self._mapping)

    def close(self) -> None:
        mapping = self._mapping
        if mapping is None:
            return
        self.wipe()
        if self.locked:
            _unlock_region(mapping)
        self.locked = False
        self._mapping = None
        mapping.close()

    def __enter__(self) -> SensitiveBuffer:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass


def _copy_to_larger(buffer: SensitiveBuffer, used: int, capacity: int) -> SensitiveBuffer:
    larger = SensitiveBuffer(capacity)
    source = buffer.view(used)
    destination = larger.view(used)
    try:
        destination[:] = source
    finally:
        source.release()
        destination.release()
    buffer.close()
    return larger


def load_sensitive_json(stream: BinaryIO, *, max_bytes: int = _MAX_RESPONSE_BYTES) -> Any:
    """응답을 anonymous mmap으로 받아 JSON을 읽고 모든 소유 바이트를 지운다.

    전용 mmap의 OS 잠금 실패는 거부한다. JSON parser용 bytearray는 덮어쓰지만
    page-locked가 아니며, JSON이 만든 immutable str도 별도의 미보호 경계다.
    """
    if max_bytes < 1:
        raise ValueError("max_bytes must be positive")
    capacity = min(_INITIAL_CAPACITY, max_bytes + 1)
    buffer = SensitiveBuffer(capacity)
    used = 0
    try:
        while True:
            if used == capacity:
                if capacity == max_bytes + 1:
                    raise SecureMemoryError("sensitive response exceeds limit")
                capacity = min(capacity * 2, max_bytes + 1)
                buffer = _copy_to_larger(buffer, used, capacity)
            destination = buffer.view()[used:]
            try:
                read = stream.readinto(destination)
            finally:
                destination.release()
            if read is None:
                raise SecureMemoryError("sensitive response stream is not writable-buffer compatible")
            if read == 0:
                break
            used += read
            if used > max_bytes:
                raise SecureMemoryError("sensitive response exceeds limit")

        with buffer.view(used) as source:
            parser_bytes = bytearray(source)
        try:
            return json.loads(parser_bytes)
        finally:
            _wipe_region(parser_bytes)
    finally:
        buffer.close()
