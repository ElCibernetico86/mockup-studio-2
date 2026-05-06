import React, { useState, useCallback, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { MockupCard } from './components/MockupCard';
import { Spinner, InfoIcon, DownloadIcon, SaveIcon, LoadIcon } from './components/icons';
import { auth, db, storage } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, getDocs, query, where, serverTimestamp, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, getBlob } from 'firebase/storage';
import { Cloud, CloudDownload, Pencil, Trash2, X } from 'lucide-react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}


// Types for our interactive mockup state
export interface LogoState {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  aspectRatio: number;
}
export interface MockupState {
  id: string;
  mockupSrc: string;
  logo: LogoState;
}

// Types for the profile file
interface ProfileLogoState {
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
}
interface ProfileMockup {
    mockupSrc: string;
    logo: ProfileLogoState;
}
interface Profile {
    mockups: ProfileMockup[];
}

interface CloudProfile extends Profile {
    id: string;
    userId: string;
    name: string;
    createdAt?: {
      toDate?: () => Date;
    };
    updatedAt?: {
      toDate?: () => Date;
    };
}

interface LoadedImage {
  image: HTMLImageElement;
  cleanup: () => void;
}

const EXPORT_SIZE = 2000;
const REMOTE_IMAGE_TIMEOUT_MS = 45000;

const isRemoteUrl = (src: string) => /^https?:\/\//i.test(src);

const fetchWithTimeout = async (src: string): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REMOTE_IMAGE_TIMEOUT_MS);

  try {
    return await fetch(src, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const getCanvasSafeImageSource = async (src: string): Promise<{ src: string; cleanup: () => void; crossOrigin?: string }> => {
  if (!isRemoteUrl(src)) {
    return { src, cleanup: () => {} };
  }

  try {
    const response = await fetchWithTimeout(src);
    if (!response.ok) {
      throw new Error(`Image fetch failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    console.warn('Could not fetch remote image directly; trying Firebase Storage SDK instead.', err);
  }

  try {
    const blob = await getBlob(ref(storage, src));
    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    console.warn('Could not download image through Firebase Storage SDK; trying CORS image load instead.', err);
    return { src, cleanup: () => {}, crossOrigin: 'anonymous' };
  }
};

const loadImage = async (src: string, options: { canvasSafe?: boolean } = {}): Promise<LoadedImage> => {
  const source = options.canvasSafe
    ? await getCanvasSafeImageSource(src)
    : { src, cleanup: () => {}, crossOrigin: undefined };

  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeoutId = window.setTimeout(() => {
      source.cleanup();
      reject(new Error(`Timed out while loading image: ${src}`));
    }, REMOTE_IMAGE_TIMEOUT_MS);

    if (source.crossOrigin) {
      img.crossOrigin = source.crossOrigin;
    }
    img.onload = () => {
      window.clearTimeout(timeoutId);
      resolve({ image: img, cleanup: source.cleanup });
    };
    img.onerror = () => {
      window.clearTimeout(timeoutId);
      source.cleanup();
      reject(new Error(`Failed to load image: ${src}`));
    };
    img.src = source.src;
  });
};

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas export returned an empty image.'));
        }
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
};

const getCoverTransform = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) => {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    scale,
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
};

const triggerDownload = (url: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};


const App: React.FC = () => {
  const [mockupImages, setMockupImages] = useState<string[]>([]);
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [interactiveMockups, setInteractiveMockups] = useState<MockupState[]>([]);
  const [selectedMockupId, setSelectedMockupId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [zipProgress, setZipProgress] = useState<string | null>(null);
  const [zipDownloadUrl, setZipDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profilePlacements, setProfilePlacements] = useState<ProfileLogoState[] | null>(null);
  const interactiveMockupsRef = useRef<MockupState[]>([]);
  useEffect(() => {
    interactiveMockupsRef.current = interactiveMockups;
  }, [interactiveMockups]);
  const [user, setUser] = useState<User | null>(null);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [cloudProfiles, setCloudProfiles] = useState<CloudProfile[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [busyCloudProfileId, setBusyCloudProfileId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Ensure user document exists
        try {
          await setDoc(doc(db, 'users', currentUser.uid), {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            createdAt: serverTimestamp()
          }, { merge: true });
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, 'users');
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      if (zipDownloadUrl) {
        URL.revokeObjectURL(zipDownloadUrl);
      }
    };
  }, [zipDownloadUrl]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleMockupsUpload = useCallback(async (files: FileList) => {
    setError(null);
    setProfilePlacements(null);
    const fileArray = Array.from(files);
    const base64Promises = fileArray.map(fileToBase64);
    try {
      const base64Strings = await Promise.all(base64Promises);
      setMockupImages(prev => [...prev, ...base64Strings]);
    } catch (err) {
      setError('Failed to read mockup files. Please try again.');
      console.error(err);
    }
  }, []);

  const handleLogoUpload = useCallback(async (files: FileList) => {
    setError(null);
    if (files.length > 0) {
      try {
        const base64String = await fileToBase64(files[0]);
        setLogoImage(base64String);
      } catch (err) {
        setError('Failed to read logo file. Please try again.');
        console.error(err);
      }
    }
  }, []);
  
  useEffect(() => {
    if (mockupImages.length === 0 || !logoImage) {
      setInteractiveMockups([]);
      return;
    }
    
    setIsLoading(true);
    
    const processImages = async () => {
      try {
        const { image: logoImg } = await loadImage(logoImage);
        const logoAspectRatio = logoImg.width / logoImg.height;
  
        const newMockupsPromises = mockupImages.map(async (mockupSrc, index) => {
            const existing = interactiveMockupsRef.current.find(m => m.mockupSrc === mockupSrc);
            if (existing && existing.logo.src === logoImage) {
                return existing;
            }

            if (profilePlacements && profilePlacements[index]) {
                // Use placement from profile
                const placement = profilePlacements[index];
                
                // Adjust height to preserve the new image's native aspect ratio, preventing distortion
                const adjustedHeight = placement.width / logoAspectRatio;
                
                return {
                    id: `mockup-${index}-${Date.now()}`,
                    mockupSrc,
                    logo: {
                        src: logoImage,
                        aspectRatio: logoAspectRatio,
                        x: placement.x,
                        y: placement.y,
                        width: placement.width,
                        height: adjustedHeight,
                        opacity: placement.opacity
                    }
                };
            } else {
                // Calculate default placement
                const { image: mockupImg, cleanup } = await loadImage(mockupSrc);
    
                const maxLogoWidth = mockupImg.width * 0.3;
                const scale = Math.min(maxLogoWidth / logoImg.width, mockupImg.height * 0.4 / logoImg.height);
                const logoWidth = logoImg.width * scale;
                const logoHeight = logoImg.height * scale;
                const logoX = (mockupImg.width - logoWidth) / 2;
                const logoY = mockupImg.height * 0.2;
                cleanup();
    
                return {
                    id: `mockup-${index}-${Date.now()}`,
                    mockupSrc,
                    logo: {
                    src: logoImage,
                    x: logoX,
                    y: logoY,
                    width: logoWidth,
                    height: logoHeight,
                    opacity: 1,
                    aspectRatio: logoAspectRatio,
                    }
                };
            }
        });
  
        const newMockups = await Promise.all(newMockupsPromises);
        setInteractiveMockups(newMockups);
        if (newMockups.length > 0) {
          setSelectedMockupId(newMockups[0].id);
        }
      } catch (e) {
        setError("An error occurred while preparing mockups. Ensure images are valid.");
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
  
    processImages();
  }, [mockupImages, logoImage, profilePlacements]);

  const handleUpdateMockup = (id: string, updatedLogo: LogoState) => {
    setInteractiveMockups(prev => 
      prev.map(m => m.id === id ? { ...m, logo: updatedLogo } : m)
    );
  };
  
  const handleDownloadAll = async () => {
    if (interactiveMockups.length <= 1) return;
    setIsZipping(true);
    setZipProgress('Preparing export...');
    setZipDownloadUrl(null);
    setError(null);

    try {
      const zip = new JSZip();

      for (const [index, mockup] of interactiveMockups.entries()) {
        setZipProgress(`Rendering ${index + 1} of ${interactiveMockups.length}...`);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");
        
        // Set high-quality image smoothing to preserve logo quality on resize.
        ctx.imageSmoothingEnabled = true;
        (ctx as any).imageSmoothingQuality = 'high';

        const loadedMockup = await loadImage(mockup.mockupSrc, { canvasSafe: true });
        const loadedLogo = await loadImage(mockup.logo.src, { canvasSafe: true });

        try {
          const mockupImg = loadedMockup.image;
          const logoImg = loadedLogo.image;
          const mockupWidth = mockupImg.naturalWidth || mockupImg.width;
          const mockupHeight = mockupImg.naturalHeight || mockupImg.height;
          const transform = getCoverTransform(mockupWidth, mockupHeight, EXPORT_SIZE, EXPORT_SIZE);

          canvas.width = EXPORT_SIZE;
          canvas.height = EXPORT_SIZE;
          ctx.drawImage(mockupImg, transform.x, transform.y, transform.width, transform.height);

          ctx.globalAlpha = mockup.logo.opacity;
          ctx.drawImage(
            logoImg,
            mockup.logo.x * transform.scale + transform.x,
            mockup.logo.y * transform.scale + transform.y,
            mockup.logo.width * transform.scale,
            mockup.logo.height * transform.scale
          );

          const pngBlob = await canvasToPngBlob(canvas);
          zip.file(`mockup_${index + 1}.png`, pngBlob);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
          loadedMockup.cleanup();
          loadedLogo.cleanup();
        }

        await new Promise(resolve => window.setTimeout(resolve, 0));
      }

      setZipProgress('Creating ZIP file...');
      const zipBlob = await zip.generateAsync({ type: 'blob' }, metadata => {
        setZipProgress(`Creating ZIP file... ${Math.round(metadata.percent)}%`);
      });
      setZipProgress('Starting download...');
      const downloadUrl = URL.createObjectURL(zipBlob);
      setZipDownloadUrl(downloadUrl);
      triggerDownload(downloadUrl, 'mockups.zip');

    } catch (err) {
      console.error("Failed to create zip file", err);
      setError("An error occurred while creating the zip file. Please try again.");
    } finally {
      setIsZipping(false);
      setZipProgress(null);
    }
  };
  
  const handleSaveProfile = () => {
    if (interactiveMockups.length === 0) {
        setError("There's nothing to save. Please create some mockups first.");
        return;
    }

    const profile: Profile = {
        mockups: interactiveMockups.map(m => ({
            mockupSrc: m.mockupSrc,
            logo: {
                x: m.logo.x,
                y: m.logo.y,
                width: m.logo.width,
                height: m.logo.height,
                opacity: m.logo.opacity,
            }
        }))
    };

    const profileJson = JSON.stringify(profile, null, 2);
    const blob = new Blob([profileJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mockup-profile.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadProfile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            const profile: Profile = JSON.parse(text);
            
            if (!profile.mockups || !Array.isArray(profile.mockups)) {
                throw new Error("Invalid profile format: 'mockups' array not found.");
            }

            const loadedMockupImages = profile.mockups.map(m => m.mockupSrc);
            const loadedPlacements = profile.mockups.map(m => m.logo);
            
            setMockupImages(loadedMockupImages);
            setProfilePlacements(loadedPlacements);
            setLogoImage(null); // Clear logo so user has to upload a new one
            setInteractiveMockups([]);

        } catch (err) {
            console.error("Failed to load or parse profile", err);
            setError("Failed to load profile. The file may be corrupt or in the wrong format.");
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input to allow loading the same file again
  };
  
  const triggerProfileLoad = () => {
    document.getElementById('profile-loader')?.click();
  }

  const handleSaveToCloud = async () => {
    if (!user) {
      setError("You must be signed in to save to the cloud.");
      return;
    }
    if (interactiveMockups.length === 0) {
      setError("There's nothing to save. Please create some mockups first.");
      return;
    }

    setIsSavingCloud(true);
    setError(null);

    try {
      const profileName = prompt("Enter a name for this profile:", "My Mockups");
      if (!profileName) {
        setIsSavingCloud(false);
        return;
      }

      const uploadImageAndGetURL = async (base64Str: string, path: string) => {
         if (base64Str.startsWith('http')) return base64Str;
         const imageRef = ref(storage, path);
         await uploadString(imageRef, base64Str, 'data_url');
         return await getDownloadURL(imageRef);
      };

      const uniqueId = Date.now().toString();

      const processedMockupsPromises = interactiveMockups.map(async (m, i) => {
         let bgUrl = m.mockupSrc;
         if (bgUrl.startsWith('data:')) {
             bgUrl = await uploadImageAndGetURL(bgUrl, `users/${user.uid}/mockups/${uniqueId}_${i}.png`);
         }
         return {
            mockupSrc: bgUrl,
            logo: {
               x: m.logo.x,
               y: m.logo.y,
               width: m.logo.width,
               height: m.logo.height,
               opacity: m.logo.opacity,
            }
         };
      });

      const processedMockups = await Promise.all(processedMockupsPromises);

      const profileData = {
        userId: user.uid,
        name: profileName,
        mockups: processedMockups,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await addDoc(collection(db, 'profiles'), profileData);
      alert("Profile saved to cloud successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'profiles');
    } finally {
      setIsSavingCloud(false);
    }
  };

  const fetchCloudProfiles = async () => {
    if (!user) return;
    setIsLoadingCloud(true);
    setError(null);
    try {
      const q = query(collection(db, 'profiles'), where('userId', '==', user.uid));
      const querySnapshot = await getDocs(q);
      const profiles: CloudProfile[] = [];
      querySnapshot.forEach((doc) => {
        profiles.push({ id: doc.id, ...doc.data() } as CloudProfile);
      });
      setCloudProfiles(profiles);
      setShowCloudModal(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'profiles');
    } finally {
      setIsLoadingCloud(false);
    }
  };

  const loadCloudProfile = (profile: CloudProfile) => {
    try {
      if (!profile.mockups || !Array.isArray(profile.mockups)) {
        throw new Error("Invalid profile format.");
      }

      const loadedMockupImages = profile.mockups.map((m: any) => m.mockupSrc);
      const loadedPlacements = profile.mockups.map((m: any) => m.logo);
      
      setMockupImages(loadedMockupImages);
      setProfilePlacements(loadedPlacements);
      setLogoImage(null);
      setInteractiveMockups([]);
      setShowCloudModal(false);
    } catch (err) {
      console.error("Error loading profile:", err);
      setError("Failed to load the selected profile.");
    }
  };

  const renameCloudProfile = async (profile: CloudProfile) => {
    if (!user || busyCloudProfileId) return;

    const newName = prompt("Enter a new name for this profile:", profile.name)?.trim();
    if (!newName || newName === profile.name) return;

    setBusyCloudProfileId(profile.id);
    setError(null);

    try {
      await updateDoc(doc(db, 'profiles', profile.id), {
        name: newName,
        updatedAt: serverTimestamp()
      });

      setCloudProfiles(prev =>
        prev.map(item =>
          item.id === profile.id ? { ...item, name: newName } : item
        )
      );
    } catch (err) {
      console.error("Error renaming cloud profile:", err);
      setError("Failed to rename the cloud profile. Please try again.");
    } finally {
      setBusyCloudProfileId(null);
    }
  };

  const deleteCloudProfile = async (profile: CloudProfile) => {
    if (!user || busyCloudProfileId) return;

    const confirmed = confirm(`Delete "${profile.name}" from the cloud? This cannot be undone.`);
    if (!confirmed) return;

    setBusyCloudProfileId(profile.id);
    setError(null);

    try {
      await deleteDoc(doc(db, 'profiles', profile.id));
      setCloudProfiles(prev => prev.filter(item => item.id !== profile.id));
    } catch (err) {
      console.error("Error deleting cloud profile:", err);
      setError("Failed to delete the cloud profile. Please try again.");
    } finally {
      setBusyCloudProfileId(null);
    }
  };

  return (
    <div className="min-h-screen font-sans">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-10">
        
        {error && (
            <div className="bg-red-500/10 backdrop-blur-md border border-red-500/30 text-red-300 px-4 py-3 rounded-lg relative mb-6" role="alert">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{error}</span>
            </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <div className="bg-slate-800/40 backdrop-blur-lg p-6 rounded-2xl shadow-2xl border border-slate-700/80">
            <div className="flex justify-between items-center mb-1">
                <h2 className="text-2xl font-black text-blue-400">
                <span className="text-3xl font-black text-slate-600 mr-2">1</span>
                Upload Mockup Images
                </h2>
                <div className="flex gap-2">
                  {user && (
                    <button
                        onClick={fetchCloudProfiles}
                        disabled={isLoadingCloud}
                        className="flex items-center gap-2 text-sm bg-blue-600/20 text-blue-400 font-semibold py-1.5 px-3 rounded-lg hover:bg-blue-600/30 transition-colors"
                        title="Load from Cloud"
                    >
                        {isLoadingCloud ? <Spinner className="w-4 h-4" /> : <CloudDownload size={16} />}
                        <span>Cloud</span>
                    </button>
                  )}
                  <button
                      onClick={triggerProfileLoad}
                      className="flex items-center gap-2 text-sm bg-slate-700/50 text-slate-300 font-semibold py-1.5 px-3 rounded-lg hover:bg-slate-700 transition-colors"
                      title="Load a saved profile"
                  >
                      <LoadIcon />
                      <span>Local</span>
                  </button>
                </div>
                <input type="file" id="profile-loader" accept=".json" className="hidden" onChange={handleLoadProfile} />
            </div>

            <p className="text-slate-400 mb-4">Select mockup images (e.g., t-shirts, mugs).</p>
            <ImageUploader 
              onUpload={handleMockupsUpload} 
              multiple={true} 
              accept="image/jpeg, image/png, image/webp"
              />
          </div>
          <div className="bg-slate-800/40 backdrop-blur-lg p-6 rounded-2xl shadow-2xl border border-slate-700/80">
            <h2 className="text-2xl font-black text-blue-400 mb-1">
              <span className="text-3xl font-black text-slate-600 mr-2">2</span>
              Upload Your Design
            </h2>
             <p className="text-slate-400 mb-4">Select one PNG file with a transparent background.</p>
            <ImageUploader 
              onUpload={handleLogoUpload} 
              multiple={false}
              accept="image/png"
              />
          </div>
        </div>

        {(isLoading || interactiveMockups.length > 0) && (
            <div className="mt-12">
                 <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8">
                    <div className="text-center sm:text-left">
                        <h2 className="text-3xl font-black text-blue-400 mb-1">
                            <span className="text-4xl font-black text-slate-600 mr-3">3</span>
                            Your Generated Mockups
                        </h2>
                        <p className="text-slate-400">Click a mockup to select. Then drag, resize, and adjust the logo.</p>
                    </div>
                    {!isLoading && interactiveMockups.length > 0 && (
                        <div className="flex items-center gap-3 flex-wrap">
                            {user && (
                              <button
                                  onClick={handleSaveToCloud}
                                  disabled={isSavingCloud}
                                  className="flex-shrink-0 flex items-center gap-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600/30 transition-all duration-300"
                              >
                                  {isSavingCloud ? <Spinner className="w-5 h-5" /> : <Cloud size={20} />}
                                  <span>Save to Cloud</span>
                              </button>
                            )}
                            <button
                                onClick={handleSaveProfile}
                                className="flex-shrink-0 flex items-center gap-2 bg-slate-700/50 text-slate-200 font-bold py-2 px-4 rounded-lg shadow-md hover:bg-slate-700 transition-all duration-300"
                            >
                                <SaveIcon />
                                <span>Save Local</span>
                            </button>
                            <button
                                onClick={handleDownloadAll}
                                disabled={isZipping || interactiveMockups.length <= 1}
                                className="flex-shrink-0 flex items-center gap-2 bg-blue-600 text-white font-bold py-2 px-5 rounded-lg shadow-md hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/50 transition-all duration-300 disabled:bg-blue-800 disabled:cursor-not-allowed disabled:hover:shadow-none"
                            >
                                {isZipping ? (
                                <>
                                    <Spinner className="h-5 w-5" />
                                    <span>Zipping...</span>
                                </>
                                ) : (
                                <>
                                    <DownloadIcon />
                                    <span>Download All (.zip)</span>
                                </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {zipProgress && (
                    <p className="mb-6 text-center sm:text-right text-sm font-medium text-blue-300" role="status" aria-live="polite">
                        {zipProgress}
                    </p>
                )}

                {zipDownloadUrl && !isZipping && (
                    <div className="mb-6 flex justify-center sm:justify-end">
                        <a
                            href={zipDownloadUrl}
                            download="mockups.zip"
                            className="inline-flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-bold text-green-300 hover:bg-green-500/20 transition-colors"
                        >
                            <DownloadIcon />
                            <span>Download ready: mockups.zip</span>
                        </a>
                    </div>
                )}
                
                {isLoading && (
                    <div className="flex flex-col items-center justify-center p-12 bg-slate-800/40 backdrop-blur-lg rounded-2xl border border-slate-700/80">
                        <Spinner />
                        <p className="mt-4 text-lg text-slate-300 animate-pulse">Generating your mockups...</p>
                        <p className="text-sm text-slate-500">This may take a moment.</p>
                    </div>
                )}

                {!isLoading && interactiveMockups.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {interactiveMockups.map((mockup) => (
                           <MockupCard 
                                key={mockup.id} 
                                mockup={mockup} 
                                isSelected={selectedMockupId === mockup.id}
                                onSelect={() => setSelectedMockupId(mockup.id)}
                                onUpdate={handleUpdateMockup}
                           />
                        ))}
                    </div>
                )}
            </div>
        )}

        { !logoImage && mockupImages.length > 0 && (
             <div className="mt-12 flex items-center justify-center gap-3 bg-blue-900/20 backdrop-blur-md border border-blue-500/30 text-blue-300 px-6 py-4 rounded-lg">
                <InfoIcon />
                <p className="font-semibold">{profilePlacements ? 'Profile loaded. Now upload your new design!' : 'Your mockup images are ready. Now upload your design!'}</p>
            </div>
        )}

        {showCloudModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="flex justify-between items-center p-4 border-b border-slate-700">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <CloudDownload className="text-blue-400" />
                  Load from Cloud
                </h3>
                <button onClick={() => setShowCloudModal(false)} className="text-slate-400 hover:text-white transition-colors">
                  <X size={24} />
                </button>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                {cloudProfiles.length === 0 ? (
                  <p className="text-slate-400 text-center py-8">No saved profiles found.</p>
                ) : (
                  <div className="space-y-3">
                    {cloudProfiles.map(profile => {
                      const isBusy = busyCloudProfileId === profile.id;

                      return (
                        <div
                          key={profile.id}
                          className="w-full p-4 rounded-xl bg-slate-700/30 border border-slate-600/50 flex justify-between items-center gap-3"
                        >
                          <button
                            onClick={() => loadCloudProfile(profile)}
                            disabled={isBusy}
                            className="min-w-0 flex-1 text-left group disabled:cursor-wait"
                            title={`Load ${profile.name}`}
                          >
                            <p className="font-bold text-slate-200 group-hover:text-blue-400 transition-colors truncate">{profile.name}</p>
                            <p className="text-xs text-slate-400 mt-1">
                              {profile.mockups?.length || 0} mockups • {profile.createdAt?.toDate ? new Date(profile.createdAt.toDate()).toLocaleDateString() : 'Unknown date'}
                            </p>
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => loadCloudProfile(profile)}
                              disabled={isBusy}
                              className="p-2 rounded-lg text-slate-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
                              title="Load profile"
                              aria-label={`Load ${profile.name}`}
                            >
                              <CloudDownload size={18} />
                            </button>
                            <button
                              onClick={() => renameCloudProfile(profile)}
                              disabled={isBusy}
                              className="p-2 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
                              title="Rename profile"
                              aria-label={`Rename ${profile.name}`}
                            >
                              {isBusy ? <Spinner className="w-4 h-4" /> : <Pencil size={18} />}
                            </button>
                            <button
                              onClick={() => deleteCloudProfile(profile)}
                              disabled={isBusy}
                              className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
                              title="Delete profile"
                              aria-label={`Delete ${profile.name}`}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
