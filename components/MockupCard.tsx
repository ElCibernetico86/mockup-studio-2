import React, { useRef, useState, useEffect, useCallback } from 'react';
import { DownloadIcon } from './icons';
import type { MockupState, LogoState } from '../App';

interface MockupCardProps {
  mockup: MockupState;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (id: string, updatedLogo: LogoState) => void;
}

type InteractionType = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';

type InteractionState = {
    type: InteractionType;
    startX: number;
    startY: number;
    startLogoX: number;
    startLogoY: number;
    startWidth: number;
    startHeight: number;
    aspectRatio: number;
};

export const MockupCard: React.FC<MockupCardProps> = ({ mockup, isSelected, onSelect, onUpdate }) => {
  const mockupImageRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);

  const propsRef = useRef({ onUpdate, mockup, scale });
  useEffect(() => {
    propsRef.current = { onUpdate, mockup, scale };
  });

  const updateScale = useCallback(() => {
    if (mockupImageRef.current) {
      const { naturalWidth, clientWidth } = mockupImageRef.current;
      if (naturalWidth > 0) {
        setScale(clientWidth / naturalWidth);
      }
    }
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [updateScale]);

  useEffect(() => {
    if (!interaction) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const { onUpdate, mockup, scale } = propsRef.current;
      if (!interaction) return;
      
      const { type, startX, startY, startLogoX, startLogoY, startWidth, startHeight, aspectRatio } = interaction;

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      const dx = (clientX - startX) / scale;
      const dy = (clientY - startY) / scale;
      const minWidth = 20;

      let updatedLogo = { ...mockup.logo };

      if (type === 'move') {
        updatedLogo.x = startLogoX + dx;
        updatedLogo.y = startLogoY + dy;
        onUpdate(mockup.id, updatedLogo);
        return;
      }

      // --- Resize logic ---
      let newWidth = startWidth;
      let newHeight = startHeight;
      
      if (type.includes('r')) { // right handles
        newWidth = startWidth + dx;
      } else if (type.includes('l')) { // left handles
        newWidth = startWidth - dx;
      }

      if (type.includes('b')) { // bottom handles
        newHeight = startHeight + dy;
      } else if (type.includes('t')) { // top handles
        newHeight = startHeight - dy;
      }
      
      // Maintain aspect ratio. The dimension that changed more dictates the other.
      if (Math.abs(newWidth - startWidth) > Math.abs(newHeight - startHeight)) {
        newHeight = newWidth / aspectRatio;
      } else {
        newWidth = newHeight * aspectRatio;
      }

      if (newWidth >= minWidth) {
        updatedLogo.width = newWidth;
        updatedLogo.height = newHeight;
        
        // Recalculate position for handles on top or left
        if (type.includes('l')) {
          updatedLogo.x = startLogoX + (startWidth - newWidth);
        }
        if (type.includes('t')) {
          updatedLogo.y = startLogoY + (startHeight - newHeight);
        }
        onUpdate(mockup.id, updatedLogo);
      }
    };

    const handleInteractionEnd = () => setInteraction(null);

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('mouseup', handleInteractionEnd);
    document.addEventListener('touchend', handleInteractionEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('mouseup', handleInteractionEnd);
      document.removeEventListener('touchend', handleInteractionEnd);
    };
  }, [interaction]);

  const handleInteractionStart = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>, type: InteractionType) => {
    e.stopPropagation(); // Prevents the event from bubbling up to the 'move' handler on the parent
    if (type !== 'move') {
      e.preventDefault(); // Prevents text selection, etc., while resizing
    }
    onSelect();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setInteraction({
      type,
      startX: clientX,
      startY: clientY,
      startLogoX: mockup.logo.x,
      startLogoY: mockup.logo.y,
      startWidth: mockup.logo.width,
      startHeight: mockup.logo.height,
      aspectRatio: mockup.logo.aspectRatio,
    });
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(mockup.id, { ...mockup.logo, opacity: parseFloat(e.target.value) });
  };

  return (
    <div className={`group rounded-lg shadow-xl bg-slate-800/40 backdrop-blur-lg transition-all duration-300 overflow-hidden border ${isSelected ? 'border-blue-500 shadow-2xl shadow-blue-500/40' : 'border-slate-700/80'}`} onClick={onSelect}>
        <div className="relative w-full aspect-square overflow-hidden cursor-move touch-none">
            <img
                ref={mockupImageRef}
                src={mockup.mockupSrc}
                alt={`Mockup background`}
                className="w-full h-full object-cover"
                onLoad={updateScale}
                draggable={false}
            />
             <div
                onMouseDown={(e) => handleInteractionStart(e, 'move')}
                onTouchStart={(e) => handleInteractionStart(e, 'move')}
                className="absolute"
                style={{
                    left: mockup.logo.x * scale,
                    top: mockup.logo.y * scale,
                    width: mockup.logo.width * scale,
                    height: mockup.logo.height * scale,
                }}
             >
                <img
                    src={mockup.logo.src}
                    alt="Design overlay"
                    className="w-full h-full pointer-events-none"
                    style={{ opacity: mockup.logo.opacity }}
                    draggable={false}
                />
                {isSelected && (
                    <>
                        <div className="absolute inset-0 border-2 border-dashed border-blue-400 pointer-events-none"></div>
                        <div onMouseDown={(e) => handleInteractionStart(e, 'resize-tl')} onTouchStart={(e) => handleInteractionStart(e, 'resize-tl')} className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-blue-500 border-2 border-white cursor-nwse-resize z-10"/>
                        <div onMouseDown={(e) => handleInteractionStart(e, 'resize-tr')} onTouchStart={(e) => handleInteractionStart(e, 'resize-tr')} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-500 border-2 border-white cursor-nesw-resize z-10"/>
                        <div onMouseDown={(e) => handleInteractionStart(e, 'resize-bl')} onTouchStart={(e) => handleInteractionStart(e, 'resize-bl')} className="absolute -bottom-1.5 -left-1.5 w-5 h-5 rounded-full bg-blue-500 border-2 border-white cursor-nesw-resize z-10"/>
                        <div onMouseDown={(e) => handleInteractionStart(e, 'resize-br')} onTouchStart={(e) => handleInteractionStart(e, 'resize-br')} className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-500 border-2 border-white cursor-se-resize z-10"/>
                    </>
                )}
            </div>
        </div>
        {isSelected && (
          <div className="p-4 bg-slate-800/60 border-t border-slate-700/80">
            <div className="flex justify-between items-center mb-4">
                <label htmlFor={`opacity-${mockup.id}`} className="text-sm font-medium text-slate-300">Opacity</label>
                <span className="text-sm font-medium text-slate-200 bg-slate-700 px-2.5 py-1 rounded-lg">{Math.round(mockup.logo.opacity * 100)}%</span>
            </div>
            <input
              id={`opacity-${mockup.id}`}
              type="range" min="0" max="1" step="0.05"
              value={mockup.logo.opacity}
              onChange={handleOpacityChange}
              className="w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        )}
    </div>
  );
};