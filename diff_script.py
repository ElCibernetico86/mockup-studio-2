import os
import filecmp

dir1 = "/Users/Cibernetico/Downloads/mockup-studio-2"
dir2 = "/Users/Cibernetico/Downloads/mockup-studio-2 (1)"

def get_all_files(directory):
    file_paths = []
    for root, _, files in os.walk(directory):
        if 'node_modules' in root or '.git' in root or 'dist' in root:
            continue
        for file in files:
            file_paths.append(os.path.relpath(os.path.join(root, file), directory))
    return set(file_paths)

files1 = get_all_files(dir1)
files2 = get_all_files(dir2)

print("Files only in workspace:")
for f in sorted(list(files1 - files2)):
    print(f"  {f}")

print("\nFiles only in downloaded folder:")
for f in sorted(list(files2 - files1)):
    print(f"  {f}")

print("\nModified files:")
for f in sorted(list(files1.intersection(files2))):
    path1 = os.path.join(dir1, f)
    path2 = os.path.join(dir2, f)
    if not filecmp.cmp(path1, path2, shallow=False):
        print(f"  {f}")
