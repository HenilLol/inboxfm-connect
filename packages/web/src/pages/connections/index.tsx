import { KeyRound, PencilLine, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ConnectionStatusBadge } from '@/components/connections/connection-status-badge'
import { DeleteConnectionDialog } from '@/components/connections/delete-connection-dialog'
import { PieceLogo } from '@/components/connections/piece-logo'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { AppConnection } from '@/lib/api/types'
import { useConnectionsQuery, useDeleteConnection, useIntegrations } from '@/lib/query/hooks'
import { connectionLinks } from '@/lib/utils/connection-links'
import { connectionFormat } from '@/lib/utils/connection-format'

const COLUMNS = ['Integration', 'Connection name', 'External user', 'Auth type', 'Status', 'Created', 'Actions'] as const
const PAGE_SIZE = 20

function usePieceLookup() {
  const { data: pieces } = useIntegrations()
  return useMemo(() => {
    const map = new Map<string, { displayName: string; logoUrl: string }>()
    for (const piece of pieces?.data ?? []) {
      map.set(piece.name, { displayName: piece.displayName, logoUrl: piece.logoUrl })
    }
    return map
  }, [pieces])
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-[68px] w-full rounded-xl" />
      ))}
    </div>
  )
}

export default function ConnectionsPage() {
  const navigate = useNavigate()
  const pieceLookup = usePieceLookup()
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [previousCursors, setPreviousCursors] = useState<string[]>([])
  const { data, isLoading, isError, refetch } = useConnectionsQuery({ limit: PAGE_SIZE, cursor })
  const deleteConnection = useDeleteConnection()
  const [deleteTarget, setDeleteTarget] = useState<AppConnection | null>(null)

  const connections = data?.data ?? []

  const handleNext = () => {
    if (data?.next) {
      setPreviousCursors((prev) => [...prev, cursor ?? ''])
      setCursor(data.next)
    }
  }

  const handlePrevious = () => {
    if (previousCursors.length > 0) {
      const prevCursor = previousCursors[previousCursors.length - 1]
      setPreviousCursors((prev) => prev.slice(0, -1))
      setCursor(prevCursor || undefined)
    }
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteConnection.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          setDeleteTarget(null)
          toast.success('Connection deleted')
        },
        onError: (deleteError) => {
          setDeleteTarget(null)
          toast.error('Failed to delete connection', {
            description:
              deleteError instanceof Error
                ? deleteError.message
                : 'The connection could not be deleted. Try again.',
          })
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        description="Manage connected accounts and credentials."
        actions={
          <Button size="sm" asChild className="gap-1.5 shadow-xs">
            <Link to="/integrations">
              <Plus className="h-3.5 w-3.5" />
              <span>Add Connection</span>
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <ListSkeleton />
      ) : isError ? (
        <ErrorState
          title="Unable to load connections."
          description="The connection list could not be loaded. Check that you are signed in and try again."
          onRetry={() => void refetch()}
        />
      ) : connections.length === 0 && previousCursors.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No connections yet"
          description="Connect an account from the integrations catalog so authenticated tools can execute for this project."
          actionLabel="Browse Integrations"
          onAction={() => navigate('/integrations')}
        />
      ) : (
        <Card className="overflow-hidden rounded-xl shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className="px-4 py-3 font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {connections.map((connection) => {
                  const piece = pieceLookup.get(connection.pieceName)
                  return (
                    <tr key={connection.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link
                          to={`/connections/${connection.id}`}
                          className="flex items-center gap-3"
                        >
                          <PieceLogo
                            logoUrl={piece?.logoUrl}
                            pieceDisplayName={piece?.displayName ?? connection.pieceName}
                          />
                          <span className="font-medium text-foreground hover:text-primary transition-colors">
                            {piece?.displayName ?? connection.pieceName}
                          </span>
                        </Link>
                      </td>
                      <td className="max-w-[220px] px-4 py-3">
                        <Link
                          to={`/connections/${connection.id}`}
                          className="block truncate font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {connection.displayName}
                        </Link>
                      </td>
                      <td className="max-w-[160px] px-4 py-3">
                        <span className="block truncate font-mono text-[11px] text-muted-foreground" title={connection.externalId}>
                          {connection.externalId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {connectionFormat.connectionTypeLabel(connection.type)}
                      </td>
                      <td className="px-4 py-3">
                        <ConnectionStatusBadge status={connection.status} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(connection.created).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="xs" asChild className="gap-1 text-muted-foreground hover:text-foreground">
                            <Link
                              to={connectionLinks.reconnect({
                                pieceName: connection.pieceName,
                                externalId: connection.externalId,
                                displayName: connection.displayName,
                              })}
                              aria-label={`Reconnect ${connection.displayName}`}
                            >
                              <PencilLine className="h-3 w-3" />
                              <span>Reconnect</span>
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setDeleteTarget(connection)}
                            aria-label={`Delete ${connection.displayName}`}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {(data?.next || previousCursors.length > 0) && (
            <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3 text-xs">
              <span className="text-muted-foreground">
                Showing {connections.length} connections
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={previousCursors.length === 0}
                  onClick={handlePrevious}
                  aria-label="Previous page"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!data?.next}
                  onClick={handleNext}
                  aria-label="Next page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <DeleteConnectionDialog
        open={!!deleteTarget}
        connectionName={deleteTarget?.displayName}
        deleting={deleteConnection.isPending}
        onClose={() => setDeleteTarget(null)}
        onDelete={handleDelete}
      />
    </div>
  )
}
