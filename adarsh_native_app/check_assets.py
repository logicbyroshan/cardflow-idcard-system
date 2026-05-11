from PIL import Image
import os

assets_dir = r"c:\Users\iamro\Desktop\Adarsh FInal Deploye\adarsh_native_app\assets"
for f in ["icon.png", "adaptive-icon.png", "logo.png", "splash-icon.png"]:
    path = os.path.join(assets_dir, f)
    if os.path.exists(path):
        img = Image.open(path)
        print(f"{f}: size={img.size}, mode={img.mode}")
        # Get dominant color or check corners
        colors = img.getcolors(img.size[0] * img.size[1])
        if colors:
            top_color = sorted(colors, key=lambda x: x[0], reverse=True)[0]
            print(f"  Dominant color: {top_color}")
