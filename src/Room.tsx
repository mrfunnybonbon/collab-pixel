import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Share2, Pencil, MousePointer2, Trash2, Users, Eye, Undo2, Redo2, Settings, ChevronLeft, ZoomIn, ZoomOut, Maximize, Eraser, Download, Upload, Layers as LayersIcon, Plus, EyeOff, Lock, Unlock } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from './ThemeContext';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

interface Stroke {
  id: string;
  userId: string;
  userName: string;
  mode: 'pixel' | 'freehand' | 'eraser';
  color: string;
  size: number;
  layerId: string;
  points: { x: number; y: number }[];
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [projectType, setProjectType] = useState<'pixel' | 'freehand'>('pixel');
  const [resolution, setResolution] = useState<number>(32);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [layers, setLayers] = useState<Layer[]>([{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false }]);
  const [activeLayerId, setActiveLayerId] = useState<string>('layer-1');
  
  const [mode, setMode] = useState<'pixel' | 'freehand' | 'eraser'>('pixel');
  const [color, setColor] = useState<string>('#ef4444'); // Default to red
  const [size, setSize] = useState<number>(4);
  const [isDrawing, setIsDrawing] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [showAttribution, setShowAttribution] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  
  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanRef = useRef({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const userIdRef = useRef(Math.random().toString(36).substring(2, 9));
  const userNameRef = useRef(`User-${userIdRef.current.substring(0, 4)}`);
  const lastDrawTimeRef = useRef(0);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    
    socket.onopen = () => {
      socket.send(JSON.stringify({ 
        type: 'join', 
        roomId, 
        userId: userIdRef.current,
        userName: userNameRef.current
      }));
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'init') {
        setProjectType(data.projectType);
        setMode(data.projectType);
        setResolution(data.resolution);
        setStrokes(data.strokes);
        if (data.layers) setLayers(data.layers);
      } else if (data.type === 'draw') {
        setStrokes((prev) => [...prev, data.stroke]);
      } else if (data.type === 'undo') {
        setStrokes((prev) => prev.filter(s => s.id !== data.strokeId));
      } else if (data.type === 'clear') {
        setStrokes([]);
        setRedoStack([]);
      } else if (data.type === 'change_resolution') {
        setResolution(data.resolution);
        setStrokes([]);
        setRedoStack([]);
      } else if (data.type === 'user_count') {
        setUserCount(data.count);
      } else if (data.type === 'update_layers') {
        setLayers(data.layers);
      }
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, [roomId]);

  const drawStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const allStrokes = currentStrokeRef.current ? [...strokes, currentStrokeRef.current] : strokes;

    const cellWidth = canvas.width / resolution;
    const cellHeight = canvas.height / resolution;

    // Draw grid for pixel mode first
    if (projectType === 'pixel') {
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= resolution; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellWidth, 0);
        ctx.lineTo(i * cellWidth, canvas.height);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(0, i * cellHeight);
        ctx.lineTo(canvas.width, i * cellHeight);
        ctx.stroke();
      }
    }

    // Draw layers in order
    const visibleLayers = layers.filter(l => l.visible).map(l => l.id);

    allStrokes.forEach((stroke) => {
      if (!visibleLayers.includes(stroke.layerId)) return;

      if (stroke.mode === 'pixel' || stroke.mode === 'eraser') {
        if (stroke.mode === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = stroke.color;
        }

        stroke.points.forEach((p) => {
          ctx.fillRect(p.x * cellWidth, p.y * cellHeight, cellWidth, cellHeight);
          
          if (showAttribution && stroke.userId !== userIdRef.current && stroke.mode !== 'eraser') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = `${Math.max(8, cellHeight / 3)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(stroke.userName.substring(0, 1), p.x * cellWidth + cellWidth / 2, p.y * cellHeight + cellHeight / 2);
            ctx.fillStyle = stroke.color; // reset
          }
        });
        ctx.globalCompositeOperation = 'source-over'; // reset
      } else if (stroke.mode === 'freehand') {
        if (stroke.points.length === 0) return;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
        
        if (showAttribution && stroke.userId !== userIdRef.current && stroke.points.length > 0) {
          const midPoint = stroke.points[Math.floor(stroke.points.length / 2)];
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.font = '10px sans-serif';
          ctx.fillText(stroke.userName, midPoint.x, midPoint.y - stroke.size);
        }
      }
    });

  }, [strokes, resolution, projectType, showAttribution, layers]);

  useEffect(() => {
    drawStrokes();
  }, [drawStrokes]);

  const getCoordinates = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    // Adjust for zoom and pan
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    // Middle click or Space + Click for panning
    if (('button' in e && e.button === 1) || (e.altKey)) {
      e.preventDefault();
      setIsPanning(true);
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      lastPanRef.current = { x: clientX, y: clientY };
      return;
    }

    if (e.target !== canvasRef.current) return;

    e.preventDefault();
    
    const activeLayer = layers.find(l => l.id === activeLayerId);
    if (!activeLayer || !activeLayer.visible || activeLayer.locked) {
      setToast('Selected layer is hidden or locked');
      setTimeout(() => setToast(null), 2000);
      return;
    }

    setIsDrawing(true);
    const coords = getCoordinates(e);
    
    let points = [];
    if (projectType === 'pixel') {
      const canvas = canvasRef.current!;
      const cellWidth = canvas.width / resolution;
      const cellHeight = canvas.height / resolution;
      const gridX = Math.floor(coords.x / cellWidth);
      const gridY = Math.floor(coords.y / cellHeight);
      points = [{ x: gridX, y: gridY }];
    } else {
      points = [coords];
    }

    currentStrokeRef.current = {
      id: Math.random().toString(36).substring(2, 9),
      userId: userIdRef.current,
      userName: userNameRef.current,
      mode: mode,
      color,
      size,
      layerId: activeLayerId,
      points
    };
    drawStrokes();
    lastDrawTimeRef.current = Date.now();
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (isPanning) {
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      const dx = clientX - lastPanRef.current.x;
      const dy = clientY - lastPanRef.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanRef.current = { x: clientX, y: clientY };
      return;
    }

    if (!isDrawing || !currentStrokeRef.current) return;
    
    // Throttle drawing slightly for performance
    const now = Date.now();
    if (now - lastDrawTimeRef.current < 16) return; // ~60fps
    lastDrawTimeRef.current = now;

    e.preventDefault();
    const coords = getCoordinates(e);

    if (projectType === 'pixel') {
      const canvas = canvasRef.current!;
      const cellWidth = canvas.width / resolution;
      const cellHeight = canvas.height / resolution;
      const gridX = Math.floor(coords.x / cellWidth);
      const gridY = Math.floor(coords.y / cellHeight);
      
      const lastPoint = currentStrokeRef.current.points[currentStrokeRef.current.points.length - 1];
      
      if (!lastPoint || lastPoint.x !== gridX || lastPoint.y !== gridY) {
        if (lastPoint) {
          // Interpolate points between lastPoint and current point
          const dx = gridX - lastPoint.x;
          const dy = gridY - lastPoint.y;
          const steps = Math.max(Math.abs(dx), Math.abs(dy));
          
          for (let i = 1; i <= steps; i++) {
            const x = Math.round(lastPoint.x + dx * (i / steps));
            const y = Math.round(lastPoint.y + dy * (i / steps));
            // Only add if it's not the same as the very last added point
            const veryLast = currentStrokeRef.current.points[currentStrokeRef.current.points.length - 1];
            if (veryLast.x !== x || veryLast.y !== y) {
              currentStrokeRef.current.points.push({ x, y });
            }
          }
        } else {
          currentStrokeRef.current.points.push({ x: gridX, y: gridY });
        }
      }
    } else {
      currentStrokeRef.current.points.push(coords);
    }
    drawStrokes();
  };

  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawing && currentStrokeRef.current) {
      const stroke = currentStrokeRef.current;
      setStrokes((prev) => [...prev, stroke]);
      setRedoStack([]); // Clear redo stack on new action
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'draw', stroke }));
      }
    }
    setIsDrawing(false);
    currentStrokeRef.current = null;
  };

  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    
    document.addEventListener('wheel', handleGlobalWheel, { passive: false });
    return () => {
      document.removeEventListener('wheel', handleGlobalWheel);
    };
  }, []);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = -e.deltaY * 0.01;
      setZoom(prev => Math.min(Math.max(0.1, prev + zoomFactor), 5));
    }
  };

  const handleUndo = () => {
    const myStrokes = strokes.filter(s => s.userId === userIdRef.current);
    if (myStrokes.length === 0) return;
    
    const lastStroke = myStrokes[myStrokes.length - 1];
    setStrokes(prev => prev.filter(s => s.id !== lastStroke.id));
    setRedoStack(prev => [...prev, lastStroke]);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'undo', strokeId: lastStroke.id }));
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    
    const strokeToRedo = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setStrokes(prev => [...prev, strokeToRedo]);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'draw', stroke: strokeToRedo }));
    }
  };

  const handleClear = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'clear' }));
    }
    setStrokes([]);
    setRedoStack([]);
  };

  const handleResolutionChange = (newRes: number) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'change_resolution', resolution: newRes }));
    }
    setResolution(newRes);
    setStrokes([]);
    setRedoStack([]);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setToast('Link copied to clipboard!');
    setTimeout(() => setToast(null), 3000);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Create a temporary canvas to draw without grid and attribution
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;

    // Fill background
    ctx.fillStyle = projectType === 'pixel' ? 'transparent' : '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    const cellWidth = tempCanvas.width / resolution;
    const cellHeight = tempCanvas.height / resolution;
    const visibleLayers = layers.filter(l => l.visible).map(l => l.id);

    strokes.forEach((stroke) => {
      if (!visibleLayers.includes(stroke.layerId)) return;

      if (stroke.mode === 'pixel' || stroke.mode === 'eraser') {
        if (stroke.mode === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = stroke.color;
        }

        stroke.points.forEach((p) => {
          ctx.fillRect(p.x * cellWidth, p.y * cellHeight, cellWidth, cellHeight);
        });
        ctx.globalCompositeOperation = 'source-over';
      } else if (stroke.mode === 'freehand') {
        if (stroke.points.length === 0) return;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }
    });

    const dataUrl = tempCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `collabpixel-${roomId}.png`;
    a.click();
    
    setToast('Exported as PNG');
    setTimeout(() => setToast(null), 3000);
  };

  const handleExportProject = () => {
    const projectData = {
      type: projectType,
      resolution,
      strokes,
      layers
    };
    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collabpixel-${roomId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    setToast('Project exported');
    setTimeout(() => setToast(null), 3000);
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.type && data.resolution && data.strokes && data.layers) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'import_project',
              strokes: data.strokes,
              layers: data.layers,
              resolution: data.resolution
            }));
          }
          setToast('Project imported successfully');
        } else {
          setToast('Invalid project file');
        }
      } catch (err) {
        setToast('Error parsing project file');
      }
      setTimeout(() => setToast(null), 3000);
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-base flex flex-col font-sans overflow-hidden">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-accent text-accent-fg text-sm font-medium shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="h-16 border-b border-border-color px-4 flex items-center justify-between bg-bg-panel/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/')}
            className="p-2 -ml-2 rounded-lg hover:bg-bg-base text-text-muted hover:text-text-base transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              {projectType === 'pixel' ? (
                <MousePointer2 className="w-4 h-4 text-accent-fg" />
              ) : (
                <Pencil className="w-4 h-4 text-accent-fg" />
              )}
            </div>
            <div>
              <h1 className="font-medium tracking-tight leading-tight capitalize">{projectType} Project</h1>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="font-mono">{roomId}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {userCount} online
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-full bg-bg-base text-text-muted hover:text-text-base border border-border-color transition-colors"
          >
            <Settings className="w-4 h-4" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-accent text-accent-fg text-sm font-medium hover:opacity-90 transition-opacity shadow-sm"
          >
            <Share2 className="w-4 h-4" />
            Share Link
          </motion.button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Tools */}
        <aside className="w-64 border-r border-border-color bg-bg-panel/50 p-6 flex flex-col gap-6 overflow-y-auto z-10 custom-scrollbar">
          
          {/* Tools */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Tools</h2>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setMode('pixel')}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all",
                  mode === 'pixel' 
                    ? "bg-bg-active border-accent text-text-base" 
                    : "border-transparent text-text-muted hover:bg-bg-base hover:text-text-base"
                )}
                title="Pixel Tool"
              >
                <MousePointer2 className="w-4 h-4" />
                <span className="text-[10px] font-medium">Pixel</span>
              </button>
              <button
                onClick={() => setMode('freehand')}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all",
                  mode === 'freehand' 
                    ? "bg-bg-active border-accent text-text-base" 
                    : "border-transparent text-text-muted hover:bg-bg-base hover:text-text-base"
                )}
                title="Freehand Tool"
              >
                <Pencil className="w-4 h-4" />
                <span className="text-[10px] font-medium">Brush</span>
              </button>
              <button
                onClick={() => setMode('eraser')}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all",
                  mode === 'eraser' 
                    ? "bg-bg-active border-accent text-text-base" 
                    : "border-transparent text-text-muted hover:bg-bg-base hover:text-text-base"
                )}
                title="Eraser Tool"
              >
                <Eraser className="w-4 h-4" />
                <span className="text-[10px] font-medium">Eraser</span>
              </button>
            </div>
          </div>

          {/* Colors */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Color</h2>
            <div className="flex flex-wrap gap-2">
              {['#ffffff', '#a1a1aa', '#52525b', '#18181b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'].map((c) => (
                <button
                  key={c}
                  onClick={() => { setColor(c); if (mode === 'eraser') setMode(projectType); }}
                  className={cn(
                    "w-8 h-8 rounded-full border-2 transition-transform hover:scale-110",
                    color === c && mode !== 'eraser' ? "border-accent scale-110" : "border-transparent"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
              <div className="relative w-8 h-8 rounded-full overflow-hidden border-2 border-border-color">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => { setColor(e.target.value); if (mode === 'eraser') setMode(projectType); }}
                  className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Brush Size */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Size</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-text-muted">
                <span>{size}px</span>
              </div>
              <input
                type="range"
                min="1"
                max="40"
                value={size}
                onChange={(e) => setSize(parseInt(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          </div>

          {/* Grid Size (Pixel only) */}
          {projectType === 'pixel' && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Grid Size</h2>
              <div className="grid grid-cols-2 gap-2">
                {[8, 16, 32, 64, 128].map((res) => (
                  <button
                    key={res}
                    onClick={() => handleResolutionChange(res)}
                    className={cn(
                      "py-2 rounded-lg text-xs font-mono transition-colors border",
                      resolution === res
                        ? "bg-bg-active border-accent text-text-base"
                        : "border-transparent text-text-muted hover:bg-bg-base"
                    )}
                  >
                    {res}x{res}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Layers */}
          <div className="space-y-3 flex-1 flex flex-col min-h-[200px]">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-2">
                <LayersIcon className="w-3.5 h-3.5" />
                Layers
              </h2>
              <button 
                onClick={() => {
                  const newLayer = { id: `layer-${Date.now()}`, name: `Layer ${layers.length + 1}`, visible: true, locked: false };
                  const newLayers = [newLayer, ...layers];
                  setLayers(newLayers);
                  setActiveLayerId(newLayer.id);
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'update_layers', layers: newLayers }));
                  }
                }}
                className="p-1 rounded hover:bg-bg-base text-text-muted hover:text-text-base transition-colors"
                title="Add Layer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {layers.map((layer, idx) => (
                <div 
                  key={layer.id}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-lg border transition-colors cursor-pointer",
                    activeLayerId === layer.id 
                      ? "bg-bg-active border-accent/50" 
                      : "bg-bg-card border-border-color hover:border-border-hover"
                  )}
                  onClick={() => setActiveLayerId(layer.id)}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const newLayers = layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l);
                        setLayers(newLayers);
                        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'update_layers', layers: newLayers }));
                      }}
                      className="text-text-muted hover:text-text-base"
                    >
                      {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-50" />}
                    </button>
                    <span className="text-sm truncate select-none">{layer.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const newLayers = layers.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l);
                        setLayers(newLayers);
                        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'update_layers', layers: newLayers }));
                      }}
                      className="text-text-muted hover:text-text-base"
                    >
                      {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5 opacity-30" />}
                    </button>
                    {layers.length > 1 && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          const newLayers = layers.filter(l => l.id !== layer.id);
                          setLayers(newLayers);
                          if (activeLayerId === layer.id) setActiveLayerId(newLayers[0].id);
                          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'update_layers', layers: newLayers }));
                        }}
                        className="text-red-400 hover:text-red-300 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* View Options */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">View</h2>
            <button
              onClick={() => setShowAttribution(!showAttribution)}
              className={cn(
                "w-full flex items-center justify-between p-3 rounded-xl border transition-all text-sm",
                showAttribution 
                  ? "bg-bg-active border-accent text-text-base" 
                  : "border-border-color text-text-muted hover:bg-bg-base"
              )}
            >
              <span className="flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Attribution
              </span>
              <div className={cn("w-8 h-4 rounded-full transition-colors relative", showAttribution ? "bg-accent" : "bg-border-color")}>
                <div className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-bg-panel transition-transform", showAttribution ? "left-4.5" : "left-0.5")} />
              </div>
            </button>
          </div>

          {/* Actions */}
          <div className="mt-auto space-y-2 pt-6 border-t border-border-color">
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={handleUndo}
                disabled={strokes.filter(s => s.userId === userIdRef.current).length === 0}
                className="flex items-center justify-center gap-2 py-2 rounded-lg bg-bg-card border border-border-color text-text-muted hover:text-text-base hover:border-border-hover disabled:opacity-50 transition-colors text-sm"
              >
                <Undo2 className="w-4 h-4" />
                Undo
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                className="flex items-center justify-center gap-2 py-2 rounded-lg bg-bg-card border border-border-color text-text-muted hover:text-text-base hover:border-border-hover disabled:opacity-50 transition-colors text-sm"
              >
                <Redo2 className="w-4 h-4" />
                Redo
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={handleExportPNG}
                className="flex items-center justify-center gap-2 py-2 rounded-lg bg-bg-card border border-border-color text-text-muted hover:text-text-base hover:border-border-hover transition-colors text-sm"
                title="Export as PNG"
              >
                <Download className="w-4 h-4" />
                PNG
              </button>
              <button
                onClick={handleExportProject}
                className="flex items-center justify-center gap-2 py-2 rounded-lg bg-bg-card border border-border-color text-text-muted hover:text-text-base hover:border-border-hover transition-colors text-sm"
                title="Export Project File"
              >
                <Download className="w-4 h-4" />
                Project
              </button>
            </div>
            
            <label className="w-full flex items-center justify-center gap-2 py-2 mb-4 rounded-lg bg-bg-card border border-border-color text-text-muted hover:text-text-base hover:border-border-hover transition-colors text-sm cursor-pointer">
              <Upload className="w-4 h-4" />
              Import Project
              <input type="file" accept=".json" className="hidden" onChange={handleImportProject} />
            </label>

            <button
              onClick={handleClear}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors text-sm font-medium"
            >
              <Trash2 className="w-4 h-4" />
              Clear Canvas
            </button>
          </div>
        </aside>

        {/* Canvas Area */}
        <div 
          className="flex-1 bg-bg-base relative overflow-hidden"
          onWheel={handleWheel}
        >
          {/* Background Pattern */}
          <div className="absolute inset-0 z-0 opacity-[0.02] pointer-events-none" 
               style={{ backgroundImage: 'radial-gradient(var(--text-base) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
          </div>

          {/* Viewport Controls */}
          <div className="absolute bottom-6 right-6 z-10 flex items-center gap-1 bg-bg-panel border border-border-color p-1 rounded-lg shadow-lg">
            <button onClick={() => setZoom(z => Math.max(0.1, z - 0.2))} className="p-2 rounded hover:bg-bg-base text-text-muted hover:text-text-base">
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(5, z + 0.2))} className="p-2 rounded hover:bg-bg-base text-text-muted hover:text-text-base">
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-border-color mx-1" />
            <button onClick={resetView} className="p-2 rounded hover:bg-bg-base text-text-muted hover:text-text-base" title="Reset View">
              <Maximize className="w-4 h-4" />
            </button>
          </div>

          <div 
            className="w-full h-full flex items-center justify-center cursor-crosshair touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <motion.div 
              className="relative shadow-2xl shadow-black/50 rounded-lg overflow-hidden ring-1 ring-border-color bg-white"
              style={{
                x: pan.x,
                y: pan.y,
                scale: zoom,
                width: 800,
                height: 800
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <canvas
                ref={canvasRef}
                width={800}
                height={800}
                className="w-full h-full"
              />
            </motion.div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-bg-panel border border-border-color rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-border-color flex items-center justify-between">
                <h2 className="text-lg font-semibold">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="text-text-muted hover:text-text-base">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-text-muted">Theme</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {(['dark', 'light', 'midnight', 'cyberpunk'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={cn(
                          "p-3 rounded-xl border text-left capitalize transition-colors",
                          theme === t ? "border-accent bg-accent/5 text-accent" : "border-border-color hover:border-text-muted text-text-base"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-text-muted">Your Identity</h3>
                  <div className="p-3 rounded-xl bg-bg-base border border-border-color flex items-center justify-between">
                    <span className="font-mono text-sm">{userNameRef.current}</span>
                    <span className="text-xs text-text-muted">ID: {userIdRef.current}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
