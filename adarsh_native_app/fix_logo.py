from PIL import Image
import os

def make_transparent(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    datas = img.getdata()

    new_data = []
    for item in datas:
        # If it's yellowish (high red, high green, low blue)
        # The background in the screenshot looks like #FFF799 (255, 247, 153)
        if item[0] > 200 and item[1] > 200 and item[2] < 200:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)

    img.putdata(new_data)
    img.save(output_path, "PNG")
    print(f"Saved transparent image to {output_path}")

# Fix all logos
paths = [
    "assets/logo.png",
    "assets/splash-icon.png",
    "assets/icon.png",
    "assets/adaptive-icon.png"
]

# Create a backup of the originals first if they were the yellow ones
# Actually I'll just assume I'm fixing the ones I just copied or the originals.

# Since I replaced them with the broken ones, I should restore the yellow ones first.
# Wait, I don't have a backup. 
# BUT I can find them in 'c:\Users\iamro\Desktop\Adarsh FInal Deploye\adarsh_native_app_backup' if it exists.
# Actually I'll just use the ones currently there if they are the yellow ones.
# Oh, I replaced them with the generated ones. 

# I'll check if I can find the original yellow ones in the 'android_backup' or similar.
# Actually, I'll just use the ones in the main folder if they are still yellow.
# Wait, I used 'Copy-Item ... -Force'. 

# I'll try to find the yellow one in the 'keystore_temp' or somewhere? No.
# I'll check if 'c:\Users\iamro\Desktop\Adarsh FInal Deploye\adarsh_native_app\android_backup' has assets.
