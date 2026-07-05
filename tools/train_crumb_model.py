#!/usr/bin/env python3
"""Fine-tune a tiny MobileNetV3 on the crumb dataset and export TFLite.

Setup (one-time, on your local machine):

    pip install tensorflow==2.16.*

Train:

    python3 tools/train_crumb_model.py --data dataset --out assets/model

Produces assets/model/crumb_classifier.tflite (~2-4 MB) plus labels.json.
The app loads it via react-native-fast-tflite behind the same
analyzeCrumbPhoto() signature, so no UI changes are needed.
"""
import argparse
import json
import os

import tensorflow as tf

IMG_SIZE = 224


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="dataset")
    ap.add_argument("--out", default="assets/model")
    ap.add_argument("--epochs", type=int, default=12)
    args = ap.parse_args()

    train_ds, val_ds = tf.keras.utils.image_dataset_from_directory(
        args.data,
        validation_split=0.2,
        subset="both",
        seed=42,
        image_size=(IMG_SIZE, IMG_SIZE),
        batch_size=16,
    )
    labels = train_ds.class_names
    print("Classes:", labels)

    augment = tf.keras.Sequential([
        tf.keras.layers.RandomFlip("horizontal"),
        tf.keras.layers.RandomRotation(0.08),
        tf.keras.layers.RandomZoom(0.15),
        tf.keras.layers.RandomBrightness(0.2),
    ])

    base = tf.keras.applications.MobileNetV3Small(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
        include_preprocessing=True,
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3))
    x = augment(inputs)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(len(labels), activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(train_ds, validation_data=val_ds, epochs=args.epochs)

    # Brief fine-tune of the top of the backbone
    base.trainable = True
    for layer in base.layers[:-20]:
        layer.trainable = False
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-5),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(train_ds, validation_data=val_ds, epochs=4)

    os.makedirs(args.out, exist_ok=True)
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()
    model_path = os.path.join(args.out, "crumb_classifier.tflite")
    with open(model_path, "wb") as f:
        f.write(tflite_model)
    with open(os.path.join(args.out, "labels.json"), "w") as f:
        json.dump(labels, f)

    print(f"\nSaved {model_path} ({len(tflite_model) / 1e6:.1f} MB)")
    print("Next: commit assets/model/ and tell Claude to wire it into visionAnalyzer.ts")


if __name__ == "__main__":
    main()
