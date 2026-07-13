"""
Slice N/E/S/W unit sprites for every FFTA job from the ripped GBA battle
sheets on spriters-resource.com, and save them as images/{job}/sprite_{NE,SE,SW,NW}.png
(named by the isometric screen diagonal each pose faces, north = top of screen).

Each sheet packs many animation frames with no direction labels. The frame
positions turned out to be fixed per sheet "family" (confirmed by eye, job by
job) rather than derivable from sheet size alone:
  - Human/Viera/Moogle/Nu Mou share one template (two sub-variants depending
    on whether the sheet is the wide 1032px-class or narrower).
  - Bangaa sheets put their clean side-profile frame in a different column
    than the other races, so they get their own template.
East is simply West mirrored (GBA games rarely draw a separate east frame) --
the sheets' one side-profile frame reads as facing screen-left (West).

Usage: python3 games/ffta/build-directional-sprites.py [cache_dir]
Requires: Pillow, numpy, scipy.
"""
import sys, time, re, urllib.request
from pathlib import Path
from PIL import Image
import numpy as np

HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; battle-simulator-scraper/1.0; educational)'}

# job -> spriters-resource asset id (chosen to match this project's race
# assignment for the job in units.js where a job has more than one race's sheet)
JOBS = {
    'soldier': 62269, 'whiteMage': 62602, 'thief': 62551, 'fighter': 62401,
    'paladin': 62270, 'ninja': 62600, 'illusionist': 62677, 'blueMage': 62753,
    'hunter': 62755,
    'archer': 63799, 'assassin': 63800, 'elementalist': 63728, 'fencer': 63722,
    'redMage': 63801, 'sniper': 63802, 'summoner': 63803,
    'dragoon': 63321, 'warrior': 63318, 'whiteMonk': 63316, 'bishop': 63323,
    'templar': 63319,
    'mogKnight': 64060, 'juggler': 64299, 'animist': 64062, 'gunner': 64061,
    'blackMage': 63529, 'timeMage': 63579, 'alchemist': 63538, 'morpher': 63578,
}

HUMAN_TEMPLATE = {'S': (32, 8, 48, 35), 'N': (128, 8, 144, 35), 'E': (8, 54, 22, 83)}
OTHER_TEMPLATE = {'S': (32, 14, 48, 43), 'N': (128, 14, 144, 43), 'E': (104, 60, 120, 90)}
BANGAA_TEMPLATE = {'S': (32, 14, 48, 43), 'N': (128, 14, 144, 43), 'E': (8, 60, 22, 90)}
BANGAA_JOBS = {'dragoon', 'warrior', 'whiteMonk', 'bishop', 'templar'}

IMAGES_DIR = Path(__file__).resolve().parent / 'images'


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        return r.read()


def get_sheet_url(asset_id):
    html = fetch(f'https://www.spriters-resource.com/game_boy_advance/fftacticsadv/asset/{asset_id}/').decode('utf8', 'ignore')
    m = re.search(r'/media/assets/\d+/\d+\.png[^"]*', html)
    return 'https://www.spriters-resource.com' + m.group(0)


def colorkey(im):
    arr = np.array(im.convert('RGBA'))
    bg = arr[0, 0, :3].astype(int)
    diff = np.abs(arr[:, :, :3].astype(int) - bg).sum(axis=2)
    arr[:, :, 3] = np.where(diff <= 20, 0, 255)
    return Image.fromarray(arr)


def crop_tight(im_rgba, box, margin=2, pad=1):
    x0, y0, x1, y1 = box
    # Small pad tolerates the frame sitting a couple px off from the fixed
    # template box (varies slightly sheet to sheet), without padding so much
    # that we bleed into the next row/column's frame.
    exact = im_rgba.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
    arr = np.array(exact)
    ys, xs = np.where(arr[:, :, 3] > 0)
    if len(xs) == 0:
        return exact
    tight = exact.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    # No bottom margin: the renderer (IsoLayer's preserveAspectRatio="xMidYMax
    # meet") anchors sprites by their bottom edge, so padding the bottom
    # unevenly across jobs/directions made feet "float" at inconsistent
    # heights above the tile. Keep the bottom flush with the trimmed content
    # and only pad the other three sides.
    out = Image.new('RGBA', (tight.width + margin * 2, tight.height + margin), (0, 0, 0, 0))
    out.paste(tight, (margin, margin))
    return out


def process_job(job, asset_id, cache_dir):
    jobdir = IMAGES_DIR / job
    jobdir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f'sheet_{asset_id}.png'
    if not cache_file.exists():
        cache_file.write_bytes(fetch(get_sheet_url(asset_id)))
        time.sleep(0.3)
    im = Image.open(cache_file).convert('RGB')
    W, _H = im.size
    template = HUMAN_TEMPLATE if W >= 1000 else (BANGAA_TEMPLATE if job in BANGAA_JOBS else OTHER_TEMPLATE)
    im_rgba = colorkey(im)
    # These ripped frames are cardinal-ish idle poses: 'S' is the character seen
    # from the front (drawn angled down-and-left, i.e. screen SW) and 'N' its back
    # (angled up-and-left, screen NW). FFTA's four *isometric* facings are the two
    # front diagonals and two back diagonals (north = top of screen), so we build
    # all four from just front and back, each plus a horizontal mirror. The sheet's
    # side-profile 'E' frame doesn't correspond to any iso facing, so it is unused:
    #   SW = front,   SE = front mirrored,
    #   NW = back,    NE = back mirrored.
    front = crop_tight(im_rgba, template['S'])
    back  = crop_tight(im_rgba, template['N'])
    front.save(jobdir / 'sprite_SW.png')
    front.transpose(Image.FLIP_LEFT_RIGHT).save(jobdir / 'sprite_SE.png')
    back.save(jobdir / 'sprite_NW.png')
    back.transpose(Image.FLIP_LEFT_RIGHT).save(jobdir / 'sprite_NE.png')
    print(f'  {job:14} asset={asset_id} sheet={W}x{_H}')


def main():
    cache_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.cache_ffta_sheets')
    cache_dir.mkdir(parents=True, exist_ok=True)
    for job, asset_id in JOBS.items():
        try:
            process_job(job, asset_id, cache_dir)
        except Exception as e:
            print(f'  {job:14} ERROR {e}')


if __name__ == '__main__':
    main()
