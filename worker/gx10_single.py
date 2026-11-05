def get_sequence_parallel_rank():return 0
def get_sequence_parallel_world_size():return 1
def get_sp_group():raise RuntimeError('Distributed execution is disabled on GX10')
class xFuserLongContextAttention:
 def __init__(self,*args,**kwargs):raise RuntimeError('Distributed execution is disabled on GX10')
