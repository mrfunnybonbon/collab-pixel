import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MousePointer2, Pencil, Clock } from 'lucide-react';
import { motion } from 'motion/react';

interface Project {
  id: string;
  type: 'pixel' | 'freehand';
  resolution: number;
  created_at: string;
}

export default function Home() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then(res => res.json())
      .then(data => {
        setProjects(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const createProject = async (type: 'pixel' | 'freehand') => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, resolution: 32 })
      });
      const data = await res.json();
      navigate(`/${data.id}`);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-base p-8 font-sans relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(var(--text-base) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      </div>
      
      <div className="max-w-5xl mx-auto space-y-12 relative z-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <div className="w-5 h-5 grid grid-cols-2 gap-[2px]">
                <div className="bg-accent-fg rounded-[2px]"></div>
                <div className="bg-accent-fg rounded-[2px]"></div>
                <div className="bg-accent-fg rounded-[2px] opacity-50"></div>
                <div className="bg-accent-fg rounded-[2px]"></div>
              </div>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">CollabPixel</h1>
          </div>
        </header>

        <main className="space-y-12">
          <section className="space-y-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Create New Project</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => createProject('pixel')}
                className="flex items-center gap-4 p-6 rounded-2xl bg-bg-card border border-border-color hover:border-border-hover hover:bg-bg-active transition-colors text-left group"
              >
                <div className="w-12 h-12 rounded-full bg-bg-panel border border-border-color text-text-base flex items-center justify-center group-hover:bg-accent group-hover:text-accent-fg group-hover:border-accent transition-colors">
                  <MousePointer2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-medium text-lg text-text-base">Pixel Art</h3>
                  <p className="text-sm text-text-muted">Create precise pixel-by-pixel artwork</p>
                </div>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => createProject('freehand')}
                className="flex items-center gap-4 p-6 rounded-2xl bg-bg-card border border-border-color hover:border-border-hover hover:bg-bg-active transition-colors text-left group"
              >
                <div className="w-12 h-12 rounded-full bg-bg-panel border border-border-color text-text-base flex items-center justify-center group-hover:bg-accent group-hover:text-accent-fg group-hover:border-accent transition-colors">
                  <Pencil className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-medium text-lg text-text-base">Freehand Drawing</h3>
                  <p className="text-sm text-text-muted">Draw freely with smooth strokes</p>
                </div>
              </motion.button>
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Recent Projects</h2>
            {loading ? (
              <div className="text-text-muted">Loading projects...</div>
            ) : projects.length === 0 ? (
              <div className="text-text-muted p-8 text-center border border-dashed border-border-color rounded-2xl">
                No projects yet. Create one above!
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((project) => (
                  <motion.div
                    key={project.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate(`/${project.id}`)}
                    className="p-5 rounded-2xl bg-bg-card border border-border-color hover:border-border-hover hover:bg-bg-active transition-colors cursor-pointer flex flex-col gap-4 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-bg-panel border border-border-color flex items-center justify-center group-hover:bg-accent group-hover:text-accent-fg group-hover:border-accent transition-colors">
                          {project.type === 'pixel' ? (
                            <MousePointer2 className="w-4 h-4" />
                          ) : (
                            <Pencil className="w-4 h-4" />
                          )}
                        </div>
                        <span className="text-sm font-medium capitalize text-text-base">{project.type} Project</span>
                      </div>
                      <span className="text-xs font-mono text-text-muted bg-bg-base border border-border-color px-2 py-1 rounded-md">
                        {project.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted mt-auto">
                      <Clock className="w-3 h-3" />
                      {new Date(project.created_at).toLocaleDateString()}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
