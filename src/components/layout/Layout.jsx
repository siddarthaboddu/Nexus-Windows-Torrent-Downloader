import React from 'react';
import Sidebar from './Sidebar';

const Layout = ({ children, activeTab, setActiveTab, stats }) => {
    return (
        <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

            {/* Custom Drag Region for Window Move */}
            {/* Custom Drag Region for Window Move */}
            {/* Custom Drag Region for Window Move */}
            <div className="fixed top-0 left-0 w-full h-8 z-[100] app-region-drag" />

            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} stats={stats} />

            <main className="flex-1 h-full overflow-auto relative z-0 mt-8">
                {children}
            </main>
        </div>
    );
};

export default Layout;
