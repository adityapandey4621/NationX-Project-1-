import * as ImagePicker from "expo-image-picker";
import { Alert, Linking } from "react-native";

export interface PickedImage {
  uri: string;
  mimeType: string | null;
}
const MAX_BYTES = 5 * 1024 * 1024;

function accept(res: ImagePicker.ImagePickerResult): PickedImage | null {
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  if (a.fileSize && a.fileSize > MAX_BYTES) {
    Alert.alert("Photo too large", "Please choose a photo under 5 MB.");
    return null;
  }
  return { uri: a.uri, mimeType: a.mimeType ?? null };
}

const OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, allowsEditing: true, aspect: [1, 1], exif: false };

/** The system photo picker needs no permission on modern Android. */
export async function pickFromLibrary(): Promise<PickedImage | null> {
  return accept(await ImagePicker.launchImageLibraryAsync(OPTIONS));
}

/** Asks for the camera only when the person taps "Take a photo", and explains how to recover if it is refused. */
export async function takePhoto(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Camera is off", "NationX uses the camera only to photograph items for your shop. You can allow it in Settings, or choose a photo from your gallery instead.", [
      { text: "Not now", style: "cancel" },
      { text: "Open settings", onPress: () => void Linking.openSettings() },
    ]);
    return null;
  }
  return accept(await ImagePicker.launchCameraAsync(OPTIONS));
}