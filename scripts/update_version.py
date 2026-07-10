import os

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(script_dir) if os.path.basename(script_dir) == 'scripts' else os.path.abspath('.')
    gradle_path = os.path.join(root_dir, 'android_app/android/app/build.gradle')
    
    if not os.path.exists(gradle_path):
        print(f"File not found: {gradle_path}")
        return

    with open(gradle_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Perform version replacements cleanly without syntax errors
    content = content.replace('versionCode 71', 'versionCode 72')
    content = content.replace("versionName '1.0.71'", "versionName '1.0.72'")
    content = content.replace('versionName "1.0.71"', 'versionName "1.0.72"')

    with open(gradle_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Gradle version update script completed successfully.")

if __name__ == '__main__':
    main()
