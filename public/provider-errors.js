export const rejectsPersonImage=message=>/InputImageSensitiveContentDetected\.PrivacyInformation|input image[^\n]{0,120}may contain real person/i.test(String(message));
export const rejectsFaceImage=message=>/No face detected in the image|Avatar IV could not detect a human-like face/i.test(String(message));
export const FACE_IMAGE_ERROR='HeyGen Avatar IV could not detect a human-like face in this image. Use a clear human portrait. For animal or other non-human characters, choose the image-to-video workflow instead. Scene animation with a voiceover does not guarantee lip-sync. Check OpenRouter activity for billing details.';
export function providerError(message){
 if(rejectsFaceImage(message))return FACE_IMAGE_ERROR;
 return rejectsPersonImage(message)?'The selected provider rejected this reference photo because it detected a real person. This request cannot proceed with that photo under the provider’s policy. Use a reference permitted by the provider, or an avatar workflow that explicitly supports real-person photos. Check OpenRouter activity for billing details.':message;
}
