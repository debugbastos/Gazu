import sys, numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi
S,U=sys.argv[1],sys.argv[2]
srcs={'male':('man','bc9d6fe6-image.jpg'),'female':('woman','01119a94-image.jpg'),'boy':('boy','90f626bf-image.jpg'),'girl':('girl','e804e42e-image.png')}
for key,(k,f) in srcs.items():
    img=Image.open(f"{U}/{f}").convert('RGB')
    a=np.array(Image.open(f"{S}/seg/{k}_isnet.png").convert('L')).astype(np.float32)/255
    if key=='female':
        u=np.array(Image.open(f"{S}/seg/{k}_u2.png").convert('L')).astype(np.float32)/255
        core=ndi.binary_erosion(u>0.5, iterations=7)
        core=ndi.gaussian_filter(core.astype(np.float32),2)
        a=np.maximum(a,core)
    # keep largest component
    lab,n=ndi.label(a>0.25)
    if n>1:
        sizes=ndi.sum(np.ones_like(a),lab,range(1,n+1))
        keep=np.argmax(sizes)+1
        region=ndi.binary_dilation(lab==keep,iterations=3)
        a=a*region
    # fill interior holes
    filled=ndi.binary_fill_holes(a>0.5)
    a=np.maximum(a, filled.astype(np.float32))
    # slight choke to suppress halo
    a=np.clip((a-0.08)/0.92,0,1)
    alpha=Image.fromarray((a*255).astype(np.uint8))
    rgba=img.copy(); rgba.putalpha(alpha)
    bbox=alpha.point(lambda v:255 if v>8 else 0).getbbox()
    rgba=rgba.crop(bbox)
    rgba.save(f"{S}/cutouts/{key}-native.png")
    w,h=rgba.size
    # 2x Lanczos upscale (non-generative) + mild unsharp on color only
    up=rgba.resize((w*2,h*2),Image.LANCZOS)
    rgb=up.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.6,percent=60,threshold=2))
    rgb.putalpha(up.getchannel('A'))
    rgb.save(f"{S}/cutouts/{key}@2x.png")
    print(key, img.size, bbox, rgba.size, rgb.size)
