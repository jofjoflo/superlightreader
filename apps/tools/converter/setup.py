from setuptools import setup, find_packages

setup(
    name="avif-cbz-converter",
    version="1.0.0",
    description="Convert images to AVIF and package as CBZ",
    py_modules=["main"],
    install_requires=[
        "Pillow>=10.0.0",
        "pillow-avif-plugin>=1.4.0",
        "tqdm>=4.64.0",
        "rarfile>=4.0"
    ],
    entry_points={
        "console_scripts": [
            "avif-converter=main:main",
        ],
    },
    python_requires=">=3.10",
)
