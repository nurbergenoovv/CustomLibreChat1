import debounce from 'lodash/debounce';
import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { EModelEndpoint, isAgentsEndpoint, isAssistantsEndpoint, isEphemeralAgentId } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import type { Endpoint, SelectedValues } from '~/common';
import {
  useAgentDefaultPermissionLevel,
  useSelectorEffects,
  useKeyDialog,
  useEndpoints,
  useLocalize,
} from '~/hooks';
import { useAgentsMapContext, useAssistantsMapContext, useLiveAnnouncer } from '~/Providers';
import { useGetEndpointsQuery, useListAgentsQuery } from '~/data-provider';
import { useModelSelectorChatContext } from './ModelSelectorChatContext';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { filterItems } from './utils';

type ModelSelectorContextType = {
  // State
  searchValue: string;
  selectedValues: SelectedValues;
  endpointSearchValues: Record<string, string>;
  searchResults: (t.TModelSpec | Endpoint)[] | null;
  // LibreChat
  modelSpecs: t.TModelSpec[];
  mappedEndpoints: Endpoint[];
  agentsMap: t.TAgentsMap | undefined;
  assistantsMap: t.TAssistantsMap | undefined;
  endpointsConfig: t.TEndpointsConfig;

  // Functions
  endpointRequiresUserKey: (endpoint: string) => boolean;
  setSelectedValues: React.Dispatch<React.SetStateAction<SelectedValues>>;
  setSearchValue: (value: string) => void;
  setEndpointSearchValue: (endpoint: string, value: string) => void;
  handleSelectSpec: (spec: t.TModelSpec) => void;
  handleSelectEndpoint: (endpoint: Endpoint) => void;
  handleSelectModel: (endpoint: Endpoint, model: string) => void;
} & ReturnType<typeof useKeyDialog>;

const ModelSelectorContext = createContext<ModelSelectorContextType | undefined>(undefined);

export function useModelSelectorContext() {
  const context = useContext(ModelSelectorContext);
  if (context === undefined) {
    throw new Error('useModelSelectorContext must be used within a ModelSelectorProvider');
  }
  return context;
}

interface ModelSelectorProviderProps {
  children: React.ReactNode;
  startupConfig: t.TStartupConfig | undefined;
}

export function ModelSelectorProvider({ children, startupConfig }: ModelSelectorProviderProps) {
  const agentsMap = useAgentsMapContext();
  const assistantsMap = useAssistantsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { endpoint, model, spec, agent_id, assistant_id, conversation, newConversation } =
    useModelSelectorChatContext();
  const localize = useLocalize();
  const { announcePolite } = useLiveAnnouncer();
  const modelSpecs = useMemo(() => {
    const specs = startupConfig?.modelSpecs?.list ?? [];
    if (!agentsMap) {
      return specs;
    }

    /**
     * Filter modelSpecs to only include agents the user has access to.
     * Use agentsMap which already contains permission-filtered agents (consistent with other components).
     */
    return specs.filter((spec) => {
      if (spec.preset?.endpoint === EModelEndpoint.agents && spec.preset?.agent_id) {
        return spec.preset.agent_id in agentsMap;
      }
      /** Keep non-agent modelSpecs */
      return true;
    });
  }, [startupConfig, agentsMap]);

  const permissionLevel = useAgentDefaultPermissionLevel();
  const { data: agents = null } = useListAgentsQuery(
    { requiredPermission: permissionLevel },
    {
      select: (data) => data?.data,
    },
  );

  const { mappedEndpoints, endpointRequiresUserKey } = useEndpoints({
    agents,
    assistantsMap,
    startupConfig,
    endpointsConfig,
  });

  const getModelDisplayName = useCallback(
    (endpoint: Endpoint, model: string): string => {
      if (isAgentsEndpoint(endpoint.value)) {
        return endpoint.agentNames?.[model] ?? agentsMap?.[model]?.name ?? model;
      }

      if (isAssistantsEndpoint(endpoint.value)) {
        return endpoint.assistantNames?.[model] ?? model;
      }

      return model;
    },
    [agentsMap],
  );

  const { onSelectEndpoint, onSelectSpec } = useSelectMention({
    // presets,
    modelSpecs,
    conversation,
    assistantsMap,
    endpointsConfig,
    newConversation,
    returnHandlers: true,
  });

  // State
  const [selectedValues, setSelectedValues] = useState<SelectedValues>(() => {
    let initialModel = model || '';
    if (isAgentsEndpoint(endpoint) && agent_id) {
      initialModel = agent_id;
    } else if (isAssistantsEndpoint(endpoint) && assistant_id) {
      initialModel = assistant_id;
    }
    return {
      endpoint: endpoint || '',
      model: initialModel,
      modelSpec: spec || '',
    };
  });
  useSelectorEffects({
    agentsMap,
    conversation: endpoint
      ? ({
          endpoint: endpoint ?? null,
          model: model ?? null,
          spec: spec ?? null,
          agent_id: agent_id ?? null,
          assistant_id: assistant_id ?? null,
        } as any)
      : null,
    assistantsMap,
    setSelectedValues,
  });

  const [searchValue, setSearchValueState] = useState('');
  const [endpointSearchValues, setEndpointSearchValues] = useState<Record<string, string>>({});

  const keyProps = useKeyDialog();

  /** Memoized search results */
  const searchResults = useMemo(() => {
    if (!searchValue) {
      return null;
    }
    const allItems = [...modelSpecs, ...mappedEndpoints];
    return filterItems(allItems, searchValue, agentsMap, assistantsMap || {});
  }, [searchValue, modelSpecs, mappedEndpoints, agentsMap, assistantsMap]);

  const setDebouncedSearchValue = useMemo(
    () =>
      debounce((value: string) => {
        setSearchValueState(value);
      }, 200),
    [],
  );
  const setEndpointSearchValue = (endpoint: string, value: string) => {
    setEndpointSearchValues((prev) => ({
      ...prev,
      [endpoint]: value,
    }));
  };

  const handleSelectSpec = (spec: t.TModelSpec) => {
    let model = spec.preset.model ?? null;
    onSelectSpec?.(spec);
    if (isAgentsEndpoint(spec.preset.endpoint)) {
      model = spec.preset.agent_id ?? '';
    } else if (isAssistantsEndpoint(spec.preset.endpoint)) {
      model = spec.preset.assistant_id ?? '';
    }
    setSelectedValues({
      endpoint: spec.preset.endpoint,
      model,
      modelSpec: spec.name,
    });
  };

  const handleSelectEndpoint = (endpoint: Endpoint) => {
    if (!endpoint.hasModels) {
      if (endpoint.value) {
        onSelectEndpoint?.(endpoint.value);
      }
      setSelectedValues({
        endpoint: endpoint.value,
        model: '',
        modelSpec: '',
      });
    }
  };

  const handleSelectModel = (endpoint: Endpoint, model: string) => {
    if (isAgentsEndpoint(endpoint.value)) {
      onSelectEndpoint?.(endpoint.value, {
        agent_id: model,
        model: agentsMap?.[model]?.model ?? '',
      });
    } else if (isAssistantsEndpoint(endpoint.value)) {
      onSelectEndpoint?.(endpoint.value, {
        assistant_id: model,
        model: assistantsMap?.[endpoint.value]?.[model]?.model ?? '',
      });
    } else if (endpoint.value) {
      onSelectEndpoint?.(endpoint.value, { model });
    }
    setSelectedValues({
      endpoint: endpoint.value,
      model,
      modelSpec: '',
    });

    const modelDisplayName = getModelDisplayName(endpoint, model);
    const announcement = localize('com_ui_model_selected', { 0: modelDisplayName });
    announcePolite({ message: announcement, isStatus: true });
  };

  // Auto-select the first available agent when no selection exists (e.g., first login)
  // Prefer agents from `agentsMap` (permission-filtered / available agents), fall back to `agents` list
  useEffect(() => {
    try {
      // If we already have a selected endpoint that's NOT an agents endpoint, bail out.
      if (selectedValues && selectedValues.endpoint) {
        if (!(isAgentsEndpoint(selectedValues.endpoint) && !selectedValues.model)) return;
      }

      const agentsEndpoint = mappedEndpoints?.find((e) => isAgentsEndpoint(e.value));
      if (!agentsEndpoint) return;

      // Helper for cookie read/write
      const cookieKey = 'agent_id__0';
      const getCookie = (name: string) => {
        if (typeof document === 'undefined') return null;
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
      };
      const setCookie = (name: string, value: string, days = 3650) => {
        if (typeof document === 'undefined') return;
        try {
          const expires = new Date();
          expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
          document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
        } catch (e) {
          // ignore
        }
      };

      // If a cookie exists, prefer it (handles cases where localStorage was cleared)
      const cookieAgent = getCookie(cookieKey);
      if (cookieAgent && !isEphemeralAgentId(cookieAgent)) {
        // verify agent still exists in agentsMap or agents list before selecting
        const existsInMap = agentsMap ? cookieAgent in agentsMap : false;
        const existsInList = agents ? agents.some((a) => a.id === cookieAgent && !isEphemeralAgentId(a.id)) : false;
        if (existsInMap || existsInList) {
          handleSelectModel(agentsEndpoint, cookieAgent);
          // Ensure localStorage is in sync
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem(cookieKey, cookieAgent);
            }
          } catch (e) {
            // ignore
          }
          return;
        }
      }

      // Prefer agents from agentsMap (these represent permission-filtered/available agents)
      const mapIds = agentsMap ? Object.keys(agentsMap).filter((id) => !isEphemeralAgentId(id)) : [];
      let firstAgentId: string | null = null;

      if (mapIds.length > 0) {
        firstAgentId = mapIds[0];
      } else if (agents && agents.length > 0) {
        const nonEphemeral = agents.find((a) => !isEphemeralAgentId(a.id));
        firstAgentId = nonEphemeral?.id ?? null;
      }

      if (!firstAgentId) return;
      handleSelectModel(agentsEndpoint, firstAgentId);

      // On first visit save the chosen agent id under `agent_id__0` in localStorage and cookie
      try {
        const key = cookieKey;
        if (typeof window !== 'undefined' && window.localStorage) {
          // write to localStorage (best-effort)
          try {
            window.localStorage.setItem(key, firstAgentId);
          } catch (e) {
            // ignore
          }
        }
        // always try to write cookie so the selection survives a localStorage clear
        setCookie(key, firstAgentId);
      } catch (e) {
        // ignore storage errors (e.g., private mode)
      }
    } catch (e) {
      // ignore
    }
  }, [agentsMap, agents, mappedEndpoints, selectedValues, handleSelectModel]);

  const value = {
    // State
    searchValue,
    searchResults,
    selectedValues,
    endpointSearchValues,
    // LibreChat
    agentsMap,
    modelSpecs,
    assistantsMap,
    mappedEndpoints,
    endpointsConfig,

    // Functions
    handleSelectSpec,
    handleSelectModel,
    setSelectedValues,
    handleSelectEndpoint,
    setEndpointSearchValue,
    endpointRequiresUserKey,
    setSearchValue: setDebouncedSearchValue,
    // Dialog
    ...keyProps,
  };

  return <ModelSelectorContext.Provider value={value}>{children}</ModelSelectorContext.Provider>;
}
