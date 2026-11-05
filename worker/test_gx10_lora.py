import tempfile
import unittest
from pathlib import Path
import torch
from safetensors.torch import save_file
from gx10_lora import apply_lora


class AdapterTests(unittest.TestCase):
    def test_merges_low_rank_and_direct_deltas(self):
        model = torch.nn.Sequential(torch.nn.Linear(3, 2), torch.nn.LayerNorm(2))
        before = {k: v.clone() for k, v in model.named_parameters()}
        weights = {'diffusion_model.0.lora_down.weight': torch.ones(1, 3),
                   'diffusion_model.0.lora_up.weight': torch.ones(2, 1),
                   'diffusion_model.0.diff_b': torch.ones(2),
                   'diffusion_model.1.diff': torch.ones(2)}
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'adapter.safetensors'; save_file(weights, p)
            self.assertEqual(apply_lora(model, p, .5), {'low_rank_pairs': 1, 'direct_adjustments': 2})
        torch.testing.assert_close(model[0].weight, before['0.weight']+.5)
        torch.testing.assert_close(model[0].bias, before['0.bias']+.5)
        torch.testing.assert_close(model[1].weight, before['1.weight']+.5)

    def test_bad_target_fails_before_any_model_mutation(self):
        model = torch.nn.Linear(3, 2)
        before = model.bias.clone()
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'adapter.safetensors'
            save_file({'diffusion_model.diff_b': torch.ones(2),
                       'diffusion_model.missing.diff': torch.ones(2)}, p)
            with self.assertRaisesRegex(ValueError, 'does not match'):
                apply_lora(model, p)
        torch.testing.assert_close(model.bias, before)


if __name__ == '__main__':
    unittest.main()
