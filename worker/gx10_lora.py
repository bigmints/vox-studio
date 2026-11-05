"""Merge a validated Wan acceleration adapter into a resident native model."""
import math
import torch
from safetensors.torch import load_file


@torch.no_grad()
def apply_lora(model, path, scale=1.0):
    if not math.isfinite(scale):
        raise ValueError('Adapter scale must be finite')
    weights = load_file(str(path), device='cpu')
    params = dict(model.named_parameters())
    plan, used = [], set()
    for key, value in weights.items():
        if not key.startswith('diffusion_model.'):
            raise ValueError(f'Unsupported adapter tensor: {key}')
        name = key.removeprefix('diffusion_model.')
        if name.endswith('lora_down.weight'):
            target = name.removesuffix('lora_down.weight') + 'weight'
            up_key = key.removesuffix('lora_down.weight') + 'lora_up.weight'
            up = weights.get(up_key)
            if up is None or value.ndim != 2 or up.ndim != 2 or value.shape[0] != up.shape[1]:
                raise ValueError(f'Invalid low-rank pair: {key}')
            shape = (up.shape[0], value.shape[1])
            plan.append((target, key, up_key))
            used.update((key, up_key))
        elif name.endswith('diff_b') or name.endswith('diff'):
            target = (name.removesuffix('diff_b') + 'bias' if name.endswith('diff_b')
                      else name.removesuffix('diff') + 'weight')
            shape = tuple(value.shape)
            plan.append((target, key, None))
            used.add(key)
        elif name.endswith('lora_up.weight'):
            continue
        else:
            raise ValueError(f'Unsupported adapter tensor: {key}')
        if target not in params or tuple(params[target].shape) != shape:
            raise ValueError(f'Adapter shape does not match {target}: {shape}')
        if params[target].is_meta or not params[target].is_floating_point():
            raise ValueError(f'Convert {target} to a native floating-point parameter first')
    if not plan or used != set(weights):
        raise ValueError('Adapter has no applicable weights or contains unmatched tensors')
    if len({target for target, _, _ in plan}) != len(plan):
        raise ValueError('Adapter contains duplicate target parameters')
    # Validate every target before modifying the first parameter. Merge one
    # delta at a time instead of allocating a second full diffusion model.
    for target, down_key, up_key in plan:
        param = params[target]
        down = weights[down_key].to(device=param.device, dtype=param.dtype)
        if up_key is not None:
            up = weights[up_key].to(device=param.device, dtype=param.dtype)
            delta = up @ down
        else:
            delta = down
        param.add_(delta, alpha=scale)
        del delta, down
        if up_key is not None:
            del up
    result = {'low_rank_pairs': sum(up is not None for _, _, up in plan),
              'direct_adjustments': sum(up is None for _, _, up in plan)}
    print(f'Acceleration adapter applied: {result}', flush=True)
    return result
