export interface IQuery {
  searchTerm?: string;
  page?: string;
  limit?: string;
  sortOrder?: string;
  sortBy?: string;
  fields?: string;

  //any other filter fields can be added here
  // biome-ignore lint/suspicious/noExplicitAny: dynamic filter fields
  [key: string]: any;
}
