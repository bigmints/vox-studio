"""Padding-correct SDPA with an unmasked fast path for single-portrait jobs."""
import torch


def flash_fallback(q, k, v, q_lens=None, k_lens=None, dropout_p=0.,
                   softmax_scale=None, q_scale=None, causal=False,
                   window_size=(-1, -1), deterministic=False,
                   dtype=torch.bfloat16, version=None):
    if window_size != (-1, -1):
        raise RuntimeError('Windowed attention is unsupported in this preset')
    out_dtype = q.dtype
    q, k, v = (x.transpose(1, 2).to(dtype) for x in (q, k, v))
    if q_scale is not None:
        q = q * q_scale
    mask = None
    if k_lens is not None:
        if k.shape[0] == 1:
            # A single portrait has one valid contiguous sequence. Trimming
            # padded keys is equivalent to masking, and permits Flash SDPA.
            length = int(k_lens[0])
            k, v = k[:, :, :length], v[:, :, :length]
        elif not bool(torch.all(k_lens == k.shape[-2])):
            mask = (torch.arange(k.shape[-2], device=k.device)[None, None, None, :]
                    < k_lens.to(k.device)[:, None, None, None])
    return torch.nn.functional.scaled_dot_product_attention(
        q, k, v, attn_mask=mask, dropout_p=dropout_p,
        is_causal=causal, scale=softmax_scale).transpose(1, 2).to(out_dtype)
