"""조각 분할 경계 계산 테스트 (D53). 순수 로직이라 ML·ffmpeg 없이 돈다."""

import unittest

from ccc_pipeline.chunking import Chunk, _parse_silence_output, plan_chunks


class PlanChunksTest(unittest.TestCase):
    def test_short_audio_is_one_chunk(self) -> None:
        self.assertEqual(plan_chunks([], 100.0, max_seconds=180.0), [Chunk(0.0, 100.0)])

    def test_empty_when_duration_unknown(self) -> None:
        # 길이를 못 구했으면 경계를 지어내지 않는다 — 호출부가 통짜로 폴백한다.
        self.assertEqual(plan_chunks([(1.0, 2.0)], 0.0), [])

    def test_cuts_at_the_latest_usable_silence(self) -> None:
        # 조각을 최대한 길게 가져가야 문맥이 보존된다 — 창 안의 마지막 무음에서 자른다.
        chunks = plan_chunks(
            [(40.0, 42.0), (150.0, 154.0)], duration=400.0, max_seconds=180.0, min_seconds=30.0,
        )
        self.assertAlmostEqual(chunks[0].end, 152.0)
        self.assertFalse(chunks[0].forced)

    def test_ignores_silence_shorter_than_minimum(self) -> None:
        # 20초 지점 무음은 최소 길이(30초) 안이라 쓰지 않는다.
        chunks = plan_chunks([(19.0, 21.0)], duration=400.0, max_seconds=180.0, min_seconds=30.0)
        self.assertTrue(chunks[0].forced)
        self.assertAlmostEqual(chunks[0].end, 180.0)

    def test_forced_cut_when_no_silence(self) -> None:
        chunks = plan_chunks([], duration=400.0, max_seconds=180.0, min_seconds=30.0)
        self.assertEqual([round(c.end, 3) for c in chunks], [180.0, 360.0, 400.0])
        self.assertTrue(chunks[0].forced)

    def test_chunks_are_contiguous_and_cover_the_file(self) -> None:
        chunks = plan_chunks([(100.0, 103.0), (300.0, 302.0)], duration=500.0, max_seconds=180.0)
        self.assertAlmostEqual(chunks[0].start, 0.0)
        self.assertAlmostEqual(chunks[-1].end, 500.0)
        for previous, following in zip(chunks, chunks[1:]):
            self.assertAlmostEqual(previous.end, following.start)

    def test_short_tail_is_merged_into_previous_chunk(self) -> None:
        # 꼬리 조각은 문맥이 없어 잘 틀린다 — 최소 길이보다 짧으면 앞에 붙인다.
        chunks = plan_chunks([], duration=190.0, max_seconds=180.0, min_seconds=30.0)
        self.assertEqual(len(chunks), 1)
        self.assertAlmostEqual(chunks[0].end, 190.0)


class ParseSilenceOutputTest(unittest.TestCase):
    def test_parses_pairs_and_duration(self) -> None:
        stderr = (
            "  Duration: 00:34:05.20, start: 0.000000, bitrate: 128 kb/s\n"
            "[silencedetect @ 0x1] silence_start: 12.5\n"
            "[silencedetect @ 0x1] silence_end: 14.25 | silence_duration: 1.75\n"
            "[silencedetect @ 0x1] silence_start: 100.0\n"
            "[silencedetect @ 0x1] silence_end: 101.5 | silence_duration: 1.5\n"
        )
        silences, duration = _parse_silence_output(stderr)
        self.assertEqual(silences, [(12.5, 14.25), (100.0, 101.5)])
        self.assertAlmostEqual(duration, 2045.2)

    def test_unclosed_silence_is_dropped(self) -> None:
        # 파일 끝까지 무음이면 silence_end 가 안 나온다 — 반쪽 구간은 버린다.
        silences, _ = _parse_silence_output("silence_start: 10.0\n")
        self.assertEqual(silences, [])

    def test_missing_duration_is_zero(self) -> None:
        _, duration = _parse_silence_output("nothing useful here\n")
        self.assertEqual(duration, 0.0)


if __name__ == "__main__":
    unittest.main()
