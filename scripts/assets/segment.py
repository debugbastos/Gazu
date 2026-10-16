import sys, numpy as np, onnxruntime as ort
from PIL import Image
model, mode, src, out = sys.argv[1:5]
img = Image.open(src).convert('RGB')
if mode == 'isnet':
    size=(1024,1024); mean=(0.5,0.5,0.5); std=(1.0,1.0,1.0)
else:
    size=(320,320); mean=(0.485,0.456,0.406); std=(0.229,0.224,0.225)
im = np.array(img.resize(size, Image.LANCZOS)).astype(np.float32)
im = im/np.max(im)
x = np.zeros_like(im)
for c in range(3): x[:,:,c]=(im[:,:,c]-mean[c])/std[c]
x = x.transpose(2,0,1)[None].astype(np.float32)
s = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
o = s.run(None, {s.get_inputs()[0].name: x})[0][:,0]
ma, mi = o.max(), o.min(); p = (o-mi)/(ma-mi)
m = Image.fromarray((p[0]*255).astype(np.uint8)).resize(img.size, Image.LANCZOS)
m.save(out)
