import sys, numpy as np, cv2
S,U=sys.argv[1],sys.argv[2]
im=cv2.imread(f"{U}/29658711-image.png", cv2.IMREAD_GRAYSCALE)
up=cv2.resize(im,None,fx=4,fy=4,interpolation=cv2.INTER_CUBIC)
_,b=cv2.threshold(up,128,255,cv2.THRESH_BINARY_INV)
cnts,hier=cv2.findContours(b,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE)
items=[]
for i,c in enumerate(cnts):
    if cv2.contourArea(c)<200: continue
    x,y,w,h=cv2.boundingRect(c); items.append((x,y,w,h,i))
xs=[x for x,y,w,h,i in items]; ys=[y for x,y,w,h,i in items]
X0=min(xs); Y0=min(ys); X1=max(x+w for x,y,w,h,i in items); Y1=max(y+h for x,y,w,h,i in items)
print('bbox (4x)',X0,Y0,X1,Y1, [(x//4,y//4,w//4,h//4) for x,y,w,h,i in sorted(items)])
sc=0.25
def path(c):
    c=cv2.approxPolyDP(c,1.2,True)[:,0,:]
    pts=[((p[0]-X0)*sc,(p[1]-Y0)*sc) for p in c]
    return "M"+" L".join(f"{x:.2f} {y:.2f}" for x,y in pts)+"Z"
letters=[]; line=None
for x,y,w,h,i in sorted(items):
    d=path(cnts[i])
    if h/4<6: line=d
    else: letters.append(d)
W=(X1-X0)*sc; H=(Y1-Y0)*sc
wordH=max(h for x,y,w,h,i in items if h/4>=6)*sc
open(f"{S}/logo/meta.txt","w").write(f"{W} {H} {wordH}")
full=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.2f} {H:.2f}" fill="currentColor" role="img" aria-label="GAZU"><path fill-rule="evenodd" d="{" ".join(letters)}"/><path d="{line}"/></svg>'
word=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.2f} {wordH:.2f}" fill="currentColor" role="img" aria-label="GAZU"><path fill-rule="evenodd" d="{" ".join(letters)}"/></svg>'
open(f"{S}/logo/gazu-logo.svg","w").write(full); open(f"{S}/logo/gazu-wordmark.svg","w").write(word)
g=letters[0]
open(f"{S}/logo/letters.txt","w").write("\n".join(letters))
print(W,H,wordH,len(full))
