import os
import shutil
from PIL import Image

src_dir = r"E:\E\Adarsh Website New\static\assets"
dest_dir = r"E:\E\Adarsh Admin New\android_app\assets"

os.makedirs(dest_dir, exist_ok=True)

files = os.listdir(src_dir)
print(f"Found {len(files)} files in {src_dir}")

for filename in files:
    src_path = os.path.join(src_dir, filename)
    if os.path.isdir(src_path):
        continue
        
    name, ext = os.path.splitext(filename)
    ext = ext.lower()
    
    if ext == '.webp':
        # Direct copy webp files
        dest_path = os.path.join(dest_dir, filename)
        shutil.copy2(src_path, dest_path)
        print(f"Copied WEBP: {filename}")
    elif ext in ['.png', '.jpg', '.jpeg']:
        # Convert to webp
        dest_filename = f"{name}.webp"
        dest_path = os.path.join(dest_dir, dest_filename)
        try:
            with Image.open(src_path) as img:
                img.save(dest_path, "WEBP", quality=90)
            print(f"Converted {filename} -> {dest_filename}")
        except Exception as e:
            print(f"Failed to convert {filename}: {e}")
            # Fallback to copy original if pillow fails
            dest_path = os.path.join(dest_dir, filename)
            shutil.copy2(src_path, dest_path)
            print(f"Copied original fallback: {filename}")
            
print("Asset migration completed.")
