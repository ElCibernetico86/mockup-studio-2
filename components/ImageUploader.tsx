import React, { useState, useCallback, useRef } from 'react';
import { UploadIcon } from './icons';

interface ImageUploaderProps {
  onUpload: (files: FileList) => void;
  multiple: boolean;
  accept: string;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onUpload, multiple, accept }) => {
  const [previews, setPreviews] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  };

  const handleFiles = (files: FileList) => {
    onUpload(files);
    const previewUrls = Array.from(files).map(file => URL.createObjectURL(file));
    setPreviews(prev => multiple ? [...prev, ...previewUrls] : previewUrls);
  };
  
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (fileInputRef.current) {
        fileInputRef.current.files = files;
      }
      handleFiles(files);
    }
  }, [onUpload]);

  return (
    <div>
        <label
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={`flex justify-center items-center w-full px-6 py-10 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-300
            ${isDragging ? 'border-blue-400 bg-blue-900/40 shadow-2xl shadow-blue-400/60' : 'border-slate-600 hover:border-blue-500 hover:bg-slate-800/50 hover:shadow-lg hover:shadow-blue-500/30'}`}
        >
            <div className="text-center">
            <UploadIcon />
            <p className="mt-2 text-sm text-slate-400">
                <span className="font-semibold text-blue-400">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-slate-500">{multiple ? 'Multiple images' : 'PNG format'}</p>
            </div>
            <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple={multiple}
            accept={accept}
            onChange={handleFileChange}
            />
      </label>

      {previews.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-slate-300 mb-2">Selected {multiple ? 'Images' : 'Image'}:</h4>
          <div className={`grid gap-2 ${multiple ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5' : 'grid-cols-1'}`}>
            {previews.map((src, index) => (
              <img
                key={index}
                src={src}
                alt={`Preview ${index + 1}`}
                className={`object-cover rounded-md ${multiple ? 'w-full h-20' : 'w-24 h-24'} bg-slate-700`}
                onLoad={() => URL.revokeObjectURL(src)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};