import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';

const Layout = () => {
  return (
    <div className="flex flex-col h-screen w-full bg-transparent overflow-hidden">
      <TopNav />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto px-4 sm:px-6 lg:px-8 py-6 relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
