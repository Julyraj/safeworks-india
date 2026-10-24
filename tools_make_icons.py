#!/usr/bin/env python3
"""Generate SafeWorks app icons (PWA + Android launcher) with Pillow."""
from PIL import Image, ImageDraw
import pathlib, sys
NAVY=(15,28,43); ORANGE=(209,72,12); WHITE=(255,255,255)
root=pathlib.Path(__file__).resolve().parent

def shield(size, pad_frac, bg=True, rounded=True):
    S=size*4  # supersample
    im=Image.new("RGBA",(S,S),(0,0,0,0))
    d=ImageDraw.Draw(im)
    if bg:
        r=int(S*0.22) if rounded else 0
        d.rounded_rectangle([0,0,S-1,S-1],radius=r,fill=NAVY)
    p=S*pad_frac; w=S-2*p
    cx=S/2; top=p; bot=S-p
    pts=[(p,top+w*0.12),(cx,top),(S-p,top+w*0.12),(S-p,top+w*0.50),(cx+w*0.30,top+w*0.82),(cx,bot),(cx-w*0.30,top+w*0.82),(p,top+w*0.50)]
    d.polygon(pts,fill=ORANGE)
    # white cross
    arm=w*0.13; L=w*0.46; cy=top+w*0.47
    d.rectangle([cx-arm/2,cy-L/2,cx+arm/2,cy+L/2],fill=WHITE)
    d.rectangle([cx-L/2,cy-arm/2,cx+L/2,cy+arm/2],fill=WHITE)
    return im.resize((size,size),Image.LANCZOS)

out=root/"icons"; out.mkdir(exist_ok=True)
shield(192,0.16).save(out/"icon-192.png")
shield(512,0.16).save(out/"icon-512.png")
m=shield(512,0.24,rounded=False); m.save(out/"icon-maskable-512.png")
shield(180,0.16,rounded=False).save(out/"apple-touch-icon.png")
shield(32,0.10).save(out/"favicon-32.png")
shield(1024,0.16).save(out/"icon-1024.png")
# Android launcher icons
res=root/"app"/"android-res"
dens={"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}
fg={"mdpi":108,"hdpi":162,"xhdpi":216,"xxhdpi":324,"xxxhdpi":432}
for k,s in dens.items():
    dd=res/f"mipmap-{k}"; dd.mkdir(parents=True,exist_ok=True)
    shield(s,0.16).save(dd/"ic_launcher.png")
    # round icon: circle mask
    im=shield(s,0.18,rounded=False); mask=Image.new("L",(s*4,s*4),0); ImageDraw.Draw(mask).ellipse([0,0,s*4-1,s*4-1],fill=255); mask=mask.resize((s,s),Image.LANCZOS)
    rnd=Image.new("RGBA",(s,s),(0,0,0,0)); rnd.paste(im,(0,0),mask); rnd.save(dd/"ic_launcher_round.png")
    # adaptive foreground: shield only, inside the 66% safe zone
    shield(fg[k],0.27,bg=False).save(dd/"ic_launcher_foreground.png")
print("icons ok")
