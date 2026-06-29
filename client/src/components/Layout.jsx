import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';

const Layout = () => {
  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 overflow-hidden">
      <TopNav />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-8 relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
