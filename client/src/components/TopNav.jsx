import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Upload, History, Shield, Waves } from 'lucide-react';
import { clsx } from 'clsx';

const TopNav = () => {
  const location = useLocation();

  const navLink = (to, label, Icon, exact = false) => {
    const isActive = exact
      ? location.pathname === to
      : location.pathname === to || location.pathname.startsWith(to + '/');
    return (
      <Link
        to={to}
        className={clsx(
          'flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium',
          isActive
            ? 'bg-white/15 text-white border border-sky-400/30 shadow-[0_0_12px_rgba(56,189,248,0.2)]'
            : 'text-sky-200 hover:bg-white/10 hover:text-white border border-transparent'
        )}
      >
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <div className="w-full bg-linear-to-r from-ocean-950 via-ocean-900 to-ocean-950 text-white flex items-center justify-between h-16 px-6 shadow-2xl shrink-0 z-10 border-b border-sky-500/20">
      {/* Left — Brand + Nav */}
      <div className="flex items-center gap-8">
        <Link to="/history" className="flex items-center gap-3 group">
          <div className="bg-linear-to-br from-sky-400 to-ocean-600 p-2 rounded-xl shadow-lg shadow-sky-900/40 group-hover:scale-105 transition-transform">
            <Waves className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-linear-to-r from-sky-200 to-white">
            UniRoutine
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {navLink('/upload', 'Upload', Upload)}
          {navLink('/history', 'History', History)}
        </nav>
      </div>

      {/* Right — Auth */}
      <div className="flex items-center gap-3">
      </div>
    </div>
  );
};

export default TopNav;
