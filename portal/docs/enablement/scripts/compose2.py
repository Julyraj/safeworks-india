"""Assembles the complete walkthrough with burned-in captions. Usage: python compose2.py <video2 dir> <out.mp4>
Writes <out>.srt beside the video as well."""
import json, os, re, subprocess, sys

V = sys.argv[1]; OUT = sys.argv[2]
L = json.load(open(f"{V}/layers/layout.json"))
segs = json.load(open(f"{V}/segments.json")); ORDER = [s["id"] for s in segs]; S = {s["id"]: s for s in segs}
CARDS = {"01-hook", "02-intro", "27-recap", "28-end"}
CONSOLE = {s for s in ORDER if s[:2] in {"16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26"}}
LEAD = 0.3; MAX_SPEED = 1.5; TAIL = 0.6
os.makedirs(f"{V}/parts", exist_ok=True)
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"ffmpeg failed: {' '.join(cmd)}\n{r.stderr[-3000:]}")
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "25", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
VO = f"adelay={int(LEAD*1000)}|{int(LEAD*1000)},apad"

# ---- captions: split each narration into lines of at most ~80 characters, timed by character share
def chunks(text, limit=84):
    parts = re.split(r"(?<=[.;:?!])\s+", text.strip()); out = []
    for part in parts:
        words = part.split(); cur = ""
        for w in words:
            if len(cur) + len(w) + 1 > limit and cur: out.append(cur); cur = w
            else: cur = (cur + " " + w).strip()
        if cur: out.append(cur)
    return out
def ts(t): h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60; return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")
srt, n, t_cursor, parts, total = [], 0, 0.0, [], 0.0
for sid in ORDER:
    vo = f"{V}/vo/{sid}.wav"; vodur = S[sid]["dur"]; out = f"{V}/parts/{sid}.mp4"
    if sid in CARDS:
        dur = round(vodur + LEAD + TAIL, 2)
        run(["ffmpeg", "-y", "-loop", "1", "-framerate", "25", "-t", str(dur), "-i", f"{V}/layers/{sid}.png", "-i", vo, "-filter_complex", f"[0:v]fade=t=in:st=0:d=0.4,fade=t=out:st={dur-0.4}:d=0.4,format=yuv420p[v];[1:a]{VO}[a]", "-map", "[v]", "-map", "[a]", "-t", str(dur), *ENC, out])
    else:
        meta = json.load(open(f"{V}/frames/{sid}/meta.json")); fdur = meta["duration"]
        if fdur == 0: raise SystemExit(f"no frames for {sid}")
        target = max(vodur + LEAD + TAIL, fdur / MAX_SPEED); speed = max(1.0, fdur / target)
        lines = [(f"duration {float(ln.split()[1]) / speed:.4f}" if ln.startswith("duration") else ln.rstrip("\n")) for ln in open(f"{V}/frames/{sid}/list.txt")]
        lst = f"{V}/frames/{sid}/list-speed.txt"; open(lst, "w").write("\n".join(lines) + "\n")
        dur = round(max(target, fdur / speed), 2); box = L["CONSOLE"] if sid in CONSOLE else L["PHONE"]
        run(["ffmpeg", "-y", "-loop", "1", "-framerate", "25", "-t", str(dur), "-i", f"{V}/layers/{sid}.png", "-f", "concat", "-safe", "0", "-i", lst, "-i", vo,
             "-filter_complex", f"[1:v]scale={box['w']}:{box['h']}:flags=lanczos,setsar=1[fg];[0:v][fg]overlay={box['x']}:{box['y']}:eof_action=repeat,fade=t=in:st=0:d=0.3,fade=t=out:st={dur-0.3}:d=0.3,format=yuv420p,fps=25[v];[2:a]{VO}[a]", "-map", "[v]", "-map", "[a]", "-t", str(dur), *ENC, out])
        print(f"{sid:22} frames {fdur:5.1f}s  narration {vodur:5.1f}s  x{speed:.2f} -> {dur:5.1f}s")
    # captions for this segment
    text = S[sid]["text"]; cs = chunks(text); weights = [len(c) for c in cs]; wsum = sum(weights); t = t_cursor + LEAD
    for c, w in zip(cs, weights):
        d = vodur * w / wsum; n += 1; srt.append(f"{n}\n{ts(t)} --> {ts(min(t + d, t_cursor + dur - 0.05))}\n{c}\n"); t += d
    parts.append(out); t_cursor += dur; total += dur
open(f"{V}/parts/all.txt", "w").write("".join(f"file '{p}'\n" for p in parts))
srt_path = os.path.splitext(OUT)[0] + ".srt"; open(srt_path, "w").write("\n".join(srt))
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", f"{V}/parts/all.txt", "-c", "copy", f"{V}/parts/joined.mp4"])
style = "FontName=Inter,FontSize=10,Bold=1,PrimaryColour=&H00FFFFFF,BackColour=&H28101828,OutlineColour=&H28101828,BorderStyle=4,Outline=0,Shadow=0,MarginV=18,Alignment=2"
run(["ffmpeg", "-y", "-i", f"{V}/parts/joined.mp4", "-vf", f"subtitles={srt_path}:force_style='{style}'", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", OUT])
print(f"total {total:.1f}s ({int(total//60)}:{int(total%60):02d}) -> {OUT}\ncaptions: {srt_path} ({n} cues)")
