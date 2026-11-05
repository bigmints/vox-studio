import torch
class Ops:
 def memory_efficient_attention(self,q,k,v,attn_bias=None,op=None):
  if attn_bias is not None:raise RuntimeError("Multi-GPU attention is disabled on GX10")
  return torch.nn.functional.scaled_dot_product_attention(q.transpose(1,2),k.transpose(1,2),v.transpose(1,2)).transpose(1,2)
ops=Ops()
