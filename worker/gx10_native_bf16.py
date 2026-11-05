"""Convert INT8 checkpoint layers once to native BF16, one layer at a time."""
import torch
from optimum.quanto.nn import QLinear

def convert(model,device):
    count=0
    def visit(parent):
        nonlocal count
        for name,child in list(parent.named_children()):
            if isinstance(child,QLinear):
                layer=torch.nn.Linear(child.in_features,child.out_features,bias=child.bias is not None,device='meta',dtype=torch.bfloat16)
                layer.weight=torch.nn.Parameter(child.weight.dequantize().to(device=device,dtype=torch.bfloat16),requires_grad=False)
                if child.bias is not None:layer.bias=torch.nn.Parameter(child.bias.to(device=device,dtype=torch.bfloat16),requires_grad=False)
                setattr(parent,name,layer);count+=1
                if count%50==0:print(f'Native BF16 layers prepared: {count}',flush=True)
            else:visit(child)
    visit(model)
    model.to(device=device,dtype=torch.bfloat16)
    # Upstream explicitly computes these precision-sensitive blocks in FP32.
    model.time_embedding.float();model.time_projection.float();model.head.float()
    model.eval().requires_grad_(False)
    torch.cuda.empty_cache()
    print(f'Native BF16 model ready: {count} converted layers',flush=True)
    return model
