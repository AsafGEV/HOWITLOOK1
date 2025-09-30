import React, { useState, useCallback, useEffect } from 'react';
import { AppStatus } from './types';
import { mergeImages } from './services/geminiService';
import ImageUploader from './components/ImageUploader';
import ImageAreaSelector from './components/ImageAreaSelector';
import Button from './components/Button';
import Spinner from './components/Spinner';

interface ImageData {
  base64: string | null;
  mimeType: string | null;
}

const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?'
];

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

const loadImageFromUrl = (url: string): Promise<{ base64: string; mimeType: string }> => {
    const attemptLoad = (loadUrl: string): Promise<{ base64: string; mimeType: string }> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error('לא ניתן היה לקבל את הקונטקסט של הקנבס.'));
                }
                ctx.drawImage(img, 0, 0);

                const extension = url.split('.').pop()?.split('?')[0].toLowerCase();
                let mimeType = 'image/jpeg';
                if (extension === 'png') mimeType = 'image/png';
                else if (extension === 'webp') mimeType = 'image/webp';

                canvas.toBlob(
                    async (blob) => {
                        if (!blob) {
                            return reject(new Error('המרת קנבס ל-blob נכשלה.'));
                        }
                        try {
                            const base64 = await blobToBase64(blob);
                            const finalMimeType = blob.type && blob.type !== 'application/octet-stream' ? blob.type : mimeType;
                            resolve({ base64, mimeType: finalMimeType });
                        } catch (error) {
                            reject(error);
                        }
                    },
                    mimeType,
                    0.92
                );
            };
            img.onerror = () => {
                reject(new Error(`Failed to load image from specified src: ${loadUrl}`));
            };
            img.src = loadUrl;
        });
    };

    return new Promise(async (resolve, reject) => {
        // 1. Direct attempt
        try {
            console.log('Attempting to load image directly:', url);
            const result = await attemptLoad(url);
            resolve(result);
            return;
        } catch (directError) {
            console.warn('Direct image load failed. Attempting fallback via CORS proxies.', directError);
        }

        // 2. Proxy attempts
        for (const proxy of PROXIES) {
            const proxyUrl = proxy.endsWith('=') ? `${proxy}${encodeURIComponent(url)}` : `${proxy}${url}`;
            try {
                console.log(`Attempting to load via proxy: ${proxyUrl.substring(0, 30)}...`);
                const result = await attemptLoad(proxyUrl);
                resolve(result);
                return; // Success!
            } catch (proxyError) {
                console.warn(`Proxy attempt failed for ${proxy}.`, proxyError);
            }
        }

        // 3. If all attempts failed
        reject(new Error('לא ניתן היה לטעון את התמונה, גם לא בעזרת שירותי עזר. ייתכן שהקישור שבור או שהתמונה פרטית.'));
    });
};


const App: React.FC = () => {
  const [locationImage, setLocationImage] = useState<ImageData>({ base64: null, mimeType: null });
  const [annotatedLocationImage, setAnnotatedLocationImage] = useState<ImageData>({ base64: null, mimeType: null });
  const [productImage, setProductImage] = useState<ImageData>({ base64: null, mimeType: null });
  const [mergedImage, setMergedImage] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [isUrlProductLoading, setIsUrlProductLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleProductImageSelect = useCallback(async (file: File) => {
    setError(null);
    try {
      const base64 = await blobToBase64(file);
      setProductImage({ base64, mimeType: file.type });
    } catch (err) {
      setError('שגיאה בקריאת הקובץ.');
      console.error(err);
    }
  }, []);
  
  const handleLocationImageSelect = useCallback(async (file: File) => {
    setError(null);
    setAnnotatedLocationImage({ base64: null, mimeType: null }); // Reset annotation on new image
    try {
      const base64 = await blobToBase64(file);
      setLocationImage({ base64, mimeType: file.type });
    } catch (err) {
      setError('שגיאה בקריאת הקובץ.');
      console.error(err);
    }
  }, []);

  useEffect(() => {
    const fetchImageFromUrl = async () => {
      const params = new URLSearchParams(window.location.search);
      const imageUrl = params.get('img');

      if (imageUrl) {
        setIsUrlProductLoading(true);
        setUrlError(null);
        try {
            const { base64, mimeType } = await loadImageFromUrl(imageUrl);
            setProductImage({ base64, mimeType });
        } catch (err) {
            console.error("Failed to load product image from URL:", err);
            const message = err instanceof Error ? err.message : 'אירעה שגיאה לא צפויה.';
            setUrlError(`טעינת התמונה מהקישור נכשלה. נסה להוריד את התמונה למחשבך ולהעלות אותה ידנית. (${message})`);
        } finally {
            setIsUrlProductLoading(false);
        }
      }
    };

    fetchImageFromUrl();
  }, []);

  const handleMergeClick = async () => {
    if (!locationImage.base64 || !productImage.base64 || !locationImage.mimeType || !productImage.mimeType) {
      setError('יש להעלות תמונת רקע ותמונת מוצר.');
      return;
    }

    setStatus(AppStatus.LOADING);
    setError(null);
    setMergedImage(null);

    try {
      const resultBase64 = await mergeImages(
        locationImage.base64!,
        locationImage.mimeType!,
        productImage.base64,
        productImage.mimeType,
        annotatedLocationImage.base64,
        annotatedLocationImage.mimeType
      );
      setMergedImage(`data:image/png;base64,${resultBase64}`);
      setStatus(AppStatus.SUCCESS);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('אירעה שגיאה לא צפויה.');
      }
      setStatus(AppStatus.ERROR);
    }
  };
  
  const handleReset = () => {
    setLocationImage({ base64: null, mimeType: null });
    setAnnotatedLocationImage({ base64: null, mimeType: null });
    if (!new URLSearchParams(window.location.search).get('img')) {
      setProductImage({ base64: null, mimeType: null });
    }
    setMergedImage(null);
    setStatus(AppStatus.IDLE);
    setError(null);
    setUrlError(null);
  };

  const isProductFromUrl = new URLSearchParams(window.location.search).get('img') !== null;
  const isButtonDisabled = !locationImage.base64 || !productImage.base64;

  const renderProductUploader = () => {
    if (isProductFromUrl && isUrlProductLoading) {
      return (
        <div className="w-full">
          <label className="block text-sm font-medium text-gray-300 mb-2">תמונת מוצר (מהקישור)</label>
          <div className="mt-1 flex justify-center items-center px-6 pt-5 pb-6 border-2 border-gray-600 border-dashed rounded-md bg-gray-800 min-h-[240px]">
            <div className="space-y-1 text-center flex flex-col items-center">
              <Spinner />
              <p className="text-sm text-gray-500 mt-2">טוען תמונה מהקישור...</p>
            </div>
          </div>
        </div>
      );
    }

    return (
       <div className="w-full">
            {urlError && (
              <div className="bg-yellow-900 bg-opacity-50 border border-yellow-700 text-yellow-200 px-4 py-3 rounded-md relative mb-4 text-center" role="alert">
                <strong className="font-bold">הודעה: </strong>
                <span className="block sm:inline">{urlError}</span>
              </div>
            )}
            <ImageUploader
                id="product-upload"
                title="תמונת מוצר"
                image={productImage.base64 ? `data:${productImage.mimeType};base64,${productImage.base64}` : null}
                onImageSelect={handleProductImageSelect}
                onImageRemove={() => setProductImage({ base64: null, mimeType: null })}
            />
       </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-5xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600">
            שילוב תמונות חכם
          </h1>
          <p className="mt-3 max-w-2xl mx-auto text-lg text-gray-400">
            העלו תמונת רקע ותמונת מוצר, והבינה המלאכותית תשלב אותן יחד בצורה ריאליסטית.
          </p>
        </header>

        <main>
          {status !== AppStatus.SUCCESS && status !== AppStatus.LOADING && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 items-start">
                <ImageAreaSelector
                    id="location-upload"
                    title="תמונת רקע (אופציונלי: סמן אזור להדבקה)"
                    image={locationImage.base64 ? `data:${locationImage.mimeType};base64,${locationImage.base64}` : null}
                    onImageSelect={handleLocationImageSelect}
                    onImageRemove={() => {
                        setLocationImage({ base64: null, mimeType: null });
                        setAnnotatedLocationImage({ base64: null, mimeType: null });
                    }}
                    onAreaSelected={(base64, mimeType) => {
                        setAnnotatedLocationImage({ base64, mimeType });
                    }}
                />
                {renderProductUploader()}
            </div>
          )}

          {error && (
            <div className="bg-red-900 border border-red-600 text-red-200 px-4 py-3 rounded-md relative mb-6 text-center" role="alert">
              <strong className="font-bold">שגיאה: </strong>
              <span className="block sm:inline">{error}</span>
            </div>
          )}

          <div className="text-center mb-8">
            {status !== AppStatus.SUCCESS ? (
              <Button
                onClick={handleMergeClick}
                isLoading={status === AppStatus.LOADING}
                disabled={isButtonDisabled}
              >
                {status === AppStatus.LOADING ? 'משלב תמונות...' : 'צור תמונה משולבת'}
              </Button>
            ) : (
                <Button onClick={handleReset}>
                    {isProductFromUrl ? 'נסה עם רקע אחר' : 'התחל מחדש'}
                </Button>
            )}
          </div>
          
          {status === AppStatus.LOADING && (
             <div className="text-center p-8 bg-gray-800 rounded-lg">
                <p className="text-lg text-indigo-400 animate-pulse">הבינה המלאכותית עובדת על יצירת הקסם... נא להמתין.</p>
             </div>
          )}

          {status === AppStatus.SUCCESS && mergedImage && (
            <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-2xl">
              <h2 className="text-2xl font-bold mb-4 text-center">התמונה המשולבת שלך:</h2>
              <div className="flex justify-center">
                 <img src={mergedImage} alt="Merged result" className="rounded-lg max-w-full h-auto shadow-lg" style={{maxHeight: '70vh'}}/>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;