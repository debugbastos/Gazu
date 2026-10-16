import sys, numpy as np, cv2
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi
S,U=sys.argv[1],sys.argv[2]
img=Image.open(f"{U}/01119a94-image.jpg").convert('RGB'); A=np.array(img).astype(np.int16)
H,W=A.shape[:2]
isn=np.array(Image.open(f"{S}/seg/woman_isnet.png").convert('L')).astype(np.float32)/255
u=np.array(Image.open(f"{S}/seg/woman_u2.png").convert('L')).astype(np.float32)/255
mn=A.min(2); mx=A.max(2); sat=mx-mn
light=(mn>200)&(sat<26)
m0=ndi.binary_fill_holes(np.maximum(u,isn)>0.5)
dist=ndi.distance_transform_edt(m0)
band=m0&(dist<30)
outside=~m0
cand=(band&light)|outside
lab,n=ndi.label(cand)
outl=set(np.unique(lab[outside]))-{0}
remove=np.isin(lab,list(outl))
# manual retouch region: background visible between the legs (light pixels only)
poly=Image.new('L',(W,H),0); ImageDraw.Draw(poly).polygon([(262,585),(300,560),(345,679),(268,679)],fill=255)
remove|=(np.array(poly)>0)&(mn>205)&(sat<26)
fg=m0&~remove
fg=ndi.binary_opening(fg,iterations=1)
lab,n=ndi.label(fg); sizes=ndi.sum(np.ones_like(u),lab,range(1,n+1)); fg=lab==(np.argmax(sizes)+1)
a=fg.astype(np.float32)
def gf(I,p,r,eps):
    box=lambda x: cv2.boxFilter(x,-1,(2*r+1,2*r+1))
    mI=box(I); mp=box(p); cov=box(I*p)-mI*mp; var=box(I*I)-mI*mI
    a_=cov/(var+eps); b_=mp-a_*mI
    return box(a_)*I+box(b_)
gray=np.array(img.convert('L')).astype(np.float32)/255
a=np.clip(gf(gray,a,2,4e-3),0,1)
inner=ndi.binary_erosion(fg,iterations=3)
a=np.where(inner,1.0,a); a=np.where(ndi.binary_dilation(fg,iterations=3),a,0)
a=np.clip((a-0.1)/0.9,0,1)
alpha=Image.fromarray((a*255).astype(np.uint8))
rgba=img.copy(); rgba.putalpha(alpha)
bbox=alpha.point(lambda v:255 if v>8 else 0).getbbox(); rgba=rgba.crop(bbox)
rgba.save(f"{S}/cutouts/female-native.png")
w,h=rgba.size; up=rgba.resize((w*2,h*2),Image.LANCZOS)
rgb=up.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.6,percent=60,threshold=2)); rgb.putalpha(up.getchannel('A'))
rgb.save(f"{S}/cutouts/female@2x.png")
bgim=Image.new('RGB',rgb.size,(60,60,60)); bgim.paste(rgb,(0,0),rgb); bgim.thumbnail((700,1300)); bgim.save(f"{S}/woman_dark.jpg")
bgim=Image.new('RGB',rgb.size,(232,231,227)); bgim.paste(rgb,(0,0),rgb); bgim.thumbnail((700,1300)); bgim.save(f"{S}/woman_light.jpg")
print(bbox)
