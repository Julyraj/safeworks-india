"""Assembles the walkthrough video: title cards and scene recordings (frames with timestamps) over the rendered layers,
with the narration. Scenes longer than their narration are played a little faster (up to 1.6x) so the whole piece
stays near three minutes. Usage: python compose.py <video dir> <out.mp4>"""
import json, os, subprocess, sys

V = sys.argv[1]; OUT = sys.argv[2]
L = json.load(open(f"{V}/layers/layout.json"))
segs = {s["id"]: s for s in json.load(open(f"{V}/segments.json"))}
ORDER = ["01-hook", "02-intro", "03-signin", "04-report", "05-triage", "06-close", "07-danger", "08-offline", "09-qr", "10-inspect", "11-console", "12-cmdk", "13-recap", "14-language", "15-end"]
CARDS = {"01-hook", "02-intro", "13-recap", "15-end"}
CONSOLE = {"11-console", "12-cmdk"}
LEAD = 0.5   # silence before the narration starts
MAX_SPEED = 1.4
os.makedirs(f"{V}/parts", exist_ok=True)

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"ffmpeg failed: {' '.join(cmd)}\n{r.stderr[-2000:]}")

def vo_filter(): return f"adelay={int(LEAD*1000)}|{int(LEAD*1000)},apad"
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "25", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]

parts, total = [], 0.0
for sid in ORDER:
    vo = f"{V}/vo/{sid}.wav"; vodur = segs[sid]["dur"]; out = f"{V}/parts/{sid}.mp4"
    if sid in CARDS:
        dur = round(vodur + LEAD + 0.8, 2)
        run(["ffmpeg", "-y", "-loop", "1", "-framerate", "25", "-t", str(dur), "-i", f"{V}/layers/{sid}.png", "-i", vo,
             "-filter_complex", f"[0:v]fade=t=in:st=0:d=0.4,fade=t=out:st={dur-0.4}:d=0.4,format=yuv420p[v];[1:a]{vo_filter()}[a]",
             "-map", "[v]", "-map", "[a]", "-t", str(dur), *ENC, out])
    else:
        meta = json.load(open(f"{V}/frames/{sid}/meta.json")); fdur = meta["duration"]
        if fdur == 0: raise SystemExit(f"no frames for {sid}")
        target = max(vodur + LEAD + 0.8, fdur / MAX_SPEED)
        speed = max(1.0, fdur / target)
        # concat list with durations scaled by the speed
        lines = []
        for ln in open(f"{V}/frames/{sid}/list.txt"):
            if ln.startswith("duration"): lines.append(f"duration {float(ln.split()[1]) / speed:.4f}")
            else: lines.append(ln.rstrip("\n"))
        lst = f"{V}/frames/{sid}/list-speed.txt"; open(lst, "w").write("\n".join(lines) + "\n")
        dur = round(max(target, fdur / speed), 2)
        box = L["CONSOLE"] if sid in CONSOLE else L["PHONE"]
        run(["ffmpeg", "-y", "-loop", "1", "-framerate", "25", "-t", str(dur), "-i", f"{V}/layers/{sid}.png",
             "-f", "concat", "-safe", "0", "-i", lst, "-i", vo,
             "-filter_complex", f"[1:v]scale={box['w']}:{box['h']}:flags=lanczos,setsar=1[fg];[0:v][fg]overlay={box['x']}:{box['y']}:eof_action=repeat,fade=t=in:st=0:d=0.3,fade=t=out:st={dur-0.3}:d=0.3,format=yuv420p,fps=25[v];[2:a]{vo_filter()}[a]",
             "-map", "[v]", "-map", "[a]", "-t", str(dur), *ENC, out])
        print(f"{sid:12} frames {fdur:5.1f}s  narration {vodur:5.1f}s  speed x{speed:.2f}  -> {dur:5.1f}s")
    parts.append(out); total += dur

open(f"{V}/parts/all.txt", "w").write("".join(f"file '{p}'\n" for p in parts))
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", f"{V}/parts/all.txt", "-c", "copy", "-movflags", "+faststart", OUT])
print(f"total {total:.1f}s  ->  {OUT}")
