'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { MessageSquare, UserPlus, DollarSign, Send } from 'lucide-react';

import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
  type DashboardDataAccess,
} from '@/lib/dashboard/queries';
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types';

import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { PipelineDonut } from '@/components/dashboard/pipeline-donut';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';

import { useTranslations } from 'next-intl';

type RangeDays = 7 | 30 | 90;

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page');
  const { defaultCurrency, canAccessModule } = useAuth();
  const canInbox = canAccessModule('inbox');
  const canContacts = canAccessModule('contacts');
  const canPipelines = canAccessModule('pipelines');
  const canBroadcasts = canAccessModule('broadcasts');
  const canAutomations = canAccessModule('automations');
  const dashboardAccess = useMemo<DashboardDataAccess>(
    () => ({
      inbox: canInbox,
      contacts: canContacts,
      pipelines: canPipelines,
      broadcasts: canBroadcasts,
      automations: canAutomations,
    }),
    [canInbox, canContacts, canPipelines, canBroadcasts, canAutomations]
  );
  const visibleMetricCount =
    (canInbox ? 2 : 0) + (canContacts ? 1 : 0) + (canPipelines ? 1 : 0);
  const hasActivity = Object.values(dashboardAccess).some(Boolean);
  const activityHref = canInbox
    ? '/inbox'
    : canContacts
      ? '/contacts'
      : canPipelines
        ? '/pipelines'
        : canBroadcasts
          ? '/broadcasts'
          : canAutomations
            ? '/automations'
            : undefined;
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [range, setRange] = useState<RangeDays>(30);
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<
    Record<RangeDays, ConversationsSeriesPoint[] | null>
  >({
    7: null,
    30: null,
    90: null,
  });
  const [seriesLoading, setSeriesLoading] = useState(true);

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(true);

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(
    null
  );
  const [responseTimeLoading, setResponseTimeLoading] = useState(true);

  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadAll = useCallback(() => {
    const db = createClient();

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    if (visibleMetricCount > 0) {
      void loadMetrics(db, dashboardAccess)
        .then((m) => setMetrics(m))
        .catch((err) => console.error('[dashboard] metrics failed:', err))
        .finally(() => setMetricsLoading(false));
    }

    if (canInbox) {
      void loadConversationsSeries(db, 30)
        .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false));

      void loadResponseTime(db)
        .then((r) => setResponseTime(r))
        .catch((err) => console.error('[dashboard] response time failed:', err))
        .finally(() => setResponseTimeLoading(false));
    }

    if (canPipelines) {
      void loadPipelineDonut(db)
        .then((p) => setPipeline(p))
        .catch((err) => console.error('[dashboard] pipeline failed:', err))
        .finally(() => setPipelineLoading(false));
    }

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    if (hasActivity) {
      void loadActivity(db, 50, dashboardAccess)
        .then((a) => setActivity(a))
        .catch((err) => console.error('[dashboard] activity failed:', err))
        .finally(() => setActivityLoading(false));
    }
  }, [
    canInbox,
    canPipelines,
    dashboardAccess,
    hasActivity,
    visibleMetricCount,
  ]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      if (!canInbox) return;
      setRange(r);
      if (series[r] !== null) return;
      setSeriesLoading(true);
      const db = createClient();
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false));
    },
    [series, canInbox]
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
      </div>

      {/* Metric cards */}
      {visibleMetricCount > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metricsLoading || !metrics ? (
            Array.from({ length: visibleMetricCount }).map((_, i) => (
              <SkeletonCard key={i} />
            ))
          ) : (
            <>
              {canInbox ? (
                <MetricCard
                  title={t('activeConversations')}
                  value={metrics.activeConversations.current.toLocaleString()}
                  icon={MessageSquare}
                  delta={{
                    sign: metrics.activeConversations.previous,
                    label: deltaLabel(
                      metrics.activeConversations.previous,
                      t('newTodayVsYesterday'),
                      t('noChange', { suffix: t('newTodayVsYesterday') })
                    ),
                  }}
                />
              ) : null}
              {canContacts ? (
                <MetricCard
                  title={t('newContactsToday')}
                  value={metrics.newContactsToday.current.toLocaleString()}
                  icon={UserPlus}
                  delta={{
                    sign:
                      metrics.newContactsToday.current -
                      metrics.newContactsToday.previous,
                    label: deltaLabel(
                      metrics.newContactsToday.current -
                        metrics.newContactsToday.previous,
                      t('vsYesterday'),
                      t('noChange', { suffix: t('vsYesterday') })
                    ),
                  }}
                />
              ) : null}
              {canPipelines ? (
                <MetricCard
                  title={t('openDealsValue')}
                  value={formatCurrency(
                    metrics.openDealsValue,
                    defaultCurrency
                  )}
                  icon={DollarSign}
                  subtitle={t('openDeals', { count: metrics.openDealsCount })}
                />
              ) : null}
              {canInbox ? (
                <MetricCard
                  title={t('messagesSentToday')}
                  value={metrics.messagesSentToday.current.toLocaleString()}
                  icon={Send}
                  delta={{
                    sign:
                      metrics.messagesSentToday.current -
                      metrics.messagesSentToday.previous,
                    label: deltaLabel(
                      metrics.messagesSentToday.current -
                        metrics.messagesSentToday.previous,
                      t('vsYesterday'),
                      t('noChange', { suffix: t('vsYesterday') })
                    ),
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      {canInbox || canPipelines ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {canInbox ? (
            <div
              className={`h-full ${canPipelines ? 'lg:col-span-3' : 'lg:col-span-5'}`}
            >
              <ConversationsChart
                series={series}
                loading={seriesLoading}
                range={range}
                onRangeChange={handleRangeChange}
              />
            </div>
          ) : null}
          {canPipelines ? (
            <div
              className={`h-full ${canInbox ? 'lg:col-span-2' : 'lg:col-span-5'}`}
            >
              <PipelineDonut
                data={pipeline}
                loading={pipelineLoading}
                currency={defaultCurrency}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Response time */}
      {canInbox ? (
        <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />
      ) : null}

      {/* Activity feed */}
      {hasActivity ? (
        <ActivityFeed
          items={activity}
          loading={activityLoading}
          viewAllHref={activityHref}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------

function deltaLabel(
  delta: number,
  suffix: string,
  noChangeLabel: string
): string {
  if (delta === 0) return noChangeLabel;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toLocaleString()} ${suffix}`;
}
