import type { ProcessedBookmark } from './models.js';

/**
 * Pipeline stage interface.
 * Each stage transforms input data to output data.
 */
export interface PipelineStage<TIn = unknown, TOut = unknown> {
  readonly name: string;
  process(input: TIn): Promise<TOut>;
}

/**
 * Exporter interface for different output formats.
 */
export interface Exporter {
  readonly format: 'markdown' | 'json' | 'pdf';
  export(bookmarks: ProcessedBookmark[]): Promise<string | Buffer>;
}

/**
 * Classification rule for rule-based categorization.
 */
export interface ClassificationRule {
  type: 'domain' | 'url-pattern' | 'title-keyword' | 'chrome-folder';
  pattern: string;
  category: string;
  tags: string[];
  priority: number;
}

/**
 * AI configuration for LLM providers.
 */
export interface AIConfig {
  provider: 'deepseek' | 'openai' | 'ollama' | 'none';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  monthlyBudget?: number;
  batchSize: number;
  autoClassify: boolean;
}

/**
 * Export result from the pipeline.
 */
export interface ExportResult {
  exported: number;
  skipped: number;
  errors: Array<{ url: string; error: string }>;
}
