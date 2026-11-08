import { useState, useEffect } from 'react';
import { typography } from '../utils/typography';
import { SEO } from '../components/SEO';
import { useAuth } from '../hooks/useAuth';
import { useKbAdmin, useSiteHealth } from '../hooks';
import type { KbEntry } from '../hooks';
import { AdminLogin, EntryForm, EntryList, SiteHealthPanel } from '../components/admin';
import Icon from '../components/icons/Icon';

// Main admin dashboard
function AdminDashboard({ logout, getAccessToken }: Pick<ReturnType<typeof useAuth>, 'logout' | 'getAccessToken'>) {
  const { entries, isLoading, isPublishing, error, fetchEntries, createEntry, updateEntry, deleteEntry, publish } =
    useKbAdmin(getAccessToken);

  const [healthExpanded, setHealthExpanded] = useState(false);
  const { data: healthData, isLoading: healthLoading } = useSiteHealth(getAccessToken, healthExpanded);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KbEntry | null>(null);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleCreate = async (data: Omit<KbEntry, '_id' | '_createdAt' | '_updatedAt'>) => {
    await createEntry(data);
    setShowForm(false);
  };

  const handleUpdate = async (data: Omit<KbEntry, '_id' | '_createdAt' | '_updatedAt'>) => {
    if (!editingEntry) return;
    await updateEntry(editingEntry._id, data);
    setEditingEntry(null);
  };

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setDeleteConfirm(null);
  };

  const handleToggleActive = async (entry: KbEntry) => {
    await updateEntry(entry._id, { isActive: !entry.isActive });
  };

  const handlePublish = async () => {
    try {
      const result = await publish();
      setPublishResult(
        `Published ${result.entryCount} entries (${Math.round(result.documentSize / 1024)}KB). KB sync triggered.`,
      );
      setTimeout(() => setPublishResult(null), 10000);
    } catch {
      // Error already set by hook
    }
  };

  const activeCount = entries.filter((e) => e.isActive).length;
  const inactiveCount = entries.length - activeCount;

  return (
    <div className="min-h-screen bg-altivum-dark pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <div>
            <h1 className="text-white mb-1" style={typography.sectionHeader}>
              Knowledge Base
            </h1>
            <p className="text-altivum-silver" style={typography.bodyText}>
              Manage AI chat knowledge entries
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePublish}
              disabled={isPublishing || entries.length === 0}
              className={`px-6 py-3 font-medium uppercase tracking-wider text-sm transition-all duration-300 ${
                isPublishing || entries.length === 0
                  ? 'bg-altivum-slate/50 text-altivum-silver cursor-not-allowed'
                  : 'bg-altivum-gold text-altivum-dark hover:bg-white'
              }`}
            >
              {isPublishing ? 'Publishing...' : 'Publish to KB'}
            </button>
            <button
              onClick={logout}
              className="px-4 py-3 text-altivum-silver border border-white/10 text-sm hover:border-white/30 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Status messages */}
        {publishResult && (
          <div className="mb-6 p-4 bg-green-900/30 border-l-4 border-green-500 text-green-300 text-sm">
            {publishResult}
          </div>
        )}
        {error && <div className="mb-6 p-4 bg-red-900/30 border-l-4 border-red-500 text-red-300 text-sm">{error}</div>}

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="p-4 bg-altivum-navy/30 border border-white/5 rounded-sm">
            <div className="text-2xl text-white font-semibold">{entries.length}</div>
            <div className="text-xs text-altivum-silver uppercase tracking-wider">Total Entries</div>
          </div>
          <div className="p-4 bg-altivum-navy/30 border border-white/5 rounded-sm">
            <div className="text-2xl text-green-400 font-semibold">{activeCount}</div>
            <div className="text-xs text-altivum-silver uppercase tracking-wider">Active</div>
          </div>
          <div className="p-4 bg-altivum-navy/30 border border-white/5 rounded-sm">
            <div className="text-2xl text-altivum-silver font-semibold">{inactiveCount}</div>
            <div className="text-xs text-altivum-silver uppercase tracking-wider">Inactive</div>
          </div>
        </div>

        {/* Site Health */}
        <SiteHealthPanel
          expanded={healthExpanded}
          onToggle={() => setHealthExpanded(!healthExpanded)}
          data={healthData}
          isLoading={healthLoading}
        />

        {/* Add entry button / form */}
        {showForm ? (
          <div className="mb-8">
            <h2 className="text-white mb-4" style={typography.cardTitleLarge}>
              New Entry
            </h2>
            <EntryForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
          </div>
        ) : editingEntry ? null : (
          <button
            onClick={() => setShowForm(true)}
            className="mb-8 inline-flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 text-altivum-silver text-sm hover:border-altivum-gold hover:text-altivum-gold transition-colors"
          >
            <Icon name="add" className="text-lg" />
            Add Entry
          </button>
        )}

        {/* Entry list */}
        <EntryList
          entries={entries}
          editingEntry={editingEntry}
          deleteConfirm={deleteConfirm}
          onEdit={(entry) => {
            setEditingEntry(entry);
            setShowForm(false);
          }}
          onCancelEdit={() => setEditingEntry(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onDeleteConfirm={(id) => setDeleteConfirm(id)}
          onCancelDelete={() => setDeleteConfirm(null)}
          onToggleActive={handleToggleActive}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

// Main export — switches between login and dashboard
const Admin = () => {
  const { isAuthenticated, isLoading, error, login, logout, getAccessToken, challenge, respondToChallenge } = useAuth();

  // /admin is Cognito-gated and excluded from the sitemap/prerender, but the
  // route's `noIndex` flag (routes.ts) only drives that build-time exclusion — it
  // does NOT emit a runtime robots tag, so without this <SEO> the CSR-served shell
  // inherits index.html's `index, follow`. Render an authoritative noindex +
  // self-canonical for every admin state (loading / login / dashboard).
  return (
    <>
      <SEO
        title="Admin"
        description="Administrative console for thechrisgrey.com."
        url="https://thechrisgrey.com/admin"
        noindex
      />
      {isLoading ? (
        <div className="min-h-screen bg-altivum-dark flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-altivum-gold/30 border-t-altivum-gold rounded-full animate-spin" />
        </div>
      ) : !isAuthenticated ? (
        <AdminLogin
          onLogin={login}
          isLoading={isLoading}
          error={error}
          challenge={challenge}
          onChallenge={respondToChallenge}
          onRestart={logout}
        />
      ) : (
        <AdminDashboard logout={logout} getAccessToken={getAccessToken} />
      )}
    </>
  );
};

export default Admin;
