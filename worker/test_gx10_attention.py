import unittest
import torch
from gx10_attention import flash_fallback


class AttentionTests(unittest.TestCase):
    def test_key_padding_matches_masked_attention(self):
        for batch, lengths in [(1, [9]), (1, [6]), (2, [6, 8]), (2, [9, 9])]:
            with self.subTest(batch=batch, lengths=lengths):
                q = torch.randn(batch, 7, 2, 16)
                k = torch.randn(batch, 9, 2, 16)
                v = torch.randn_like(k)
                lens = torch.tensor(lengths)
                mask = torch.arange(9)[None, None, None, :] < lens[:, None, None, None]
                expected = torch.nn.functional.scaled_dot_product_attention(
                    q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2),
                    attn_mask=mask).transpose(1, 2)
                actual = flash_fallback(q, k, v, k_lens=lens, dtype=torch.float32)
                torch.testing.assert_close(actual, expected)


if __name__ == '__main__':
    unittest.main()
