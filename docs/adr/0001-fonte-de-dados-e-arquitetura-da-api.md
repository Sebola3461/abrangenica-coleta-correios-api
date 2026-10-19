# ADR-0001: Fonte de dados e arquitetura da API de abrangência da Logística Reversa

**Status:** Aceito
**Data:** 2026-10-19
**Decisores:** Paulo Campos

## Contexto

Precisamos de uma API HTTP, em Next.js com deploy na Vercel, que receba um CEP e diga se ele é atendido em cada modalidade de Logística Reversa dos Correios.

A única fonte é a planilha pública:

```
https://www2.correios.com.br/encomendas/servicosOnline/logisticaReversa/abrangencia/dsp/listaAreaAbrangenciaExcel.cfm
```

O que levantamos em 2026-10-19:

| Item | Valor observado |
|------|-----------------|
| Formato real | Tabela **HTML** servida como `application/msexcel`, charset ISO-8859-1. Não é XLS binário. |
| Tamanho | ~4,2 MB, 15.925 linhas |
| Colunas | `UNIDADE DE COLETA`, `DR`, `SERVIÇO`, `CEP INICIAL`, `CEP FINAL`, `PRAZO DE COLETA` |
| Serviços | `SEDEX Reverso` (5.311), `PAC Reverso` (5.311), `Disque Coleta` (5.303) |
| Prazos | `D + 1` (15.838), `D + 2` (87) |
| CEPs | Sempre `NNNNN-NNN` |
| Sobreposição | ~315 faixas por serviço se sobrepõem. Um CEP pode ser atendido por mais de uma unidade. |
| Faixas inválidas | 4 por serviço com `CEP INICIAL > CEP FINAL`, por exemplo `49910-000 → 45910-972` (AC ALCOBACA) e `06246-000 → 06046-999` (CDD HELENA MARIA). São erros de digitação na origem. |
| Disponibilidade | O download leva de 4 a 5 s. Pelo `curl` houve um *connection reset* intermitente. O `fetch` do Node 24 baixou sem problema. |

O que pesa na decisão:

- O servidor dos Correios é lento e instável, e não temos SLA dele.
- Na Vercel a função é serverless: cada *cold start* perde o estado em memória.
- O dado muda pouco (é uma tabela operacional), então perder alguns dias de atualização é aceitável.
- O consumo esperado é pequeno: consultas pontuais de CEP feitas por outros sistemas.

## Decisão

Gerar um **snapshot versionado** da planilha em JSON. O snapshot é atualizado por um **GitHub Action agendado** e a API responde **somente a partir dele**, sem chamar os Correios durante uma requisição.

1. Um script `scripts/sync.ts` baixa a planilha, decodifica ISO-8859-1, faz o parse do HTML, normaliza os dados e grava `data/abrangencia.json`. O arquivo inclui metadados: data da coleta, hash da fonte, totais e faixas descartadas.
2. O workflow `.github/workflows/sync.yml` roda todo dia (cron) e também sob demanda (`workflow_dispatch`). O commit só acontece se o conteúdo mudou. O push dispara o deploy automático da Vercel.
3. As rotas da API importam o JSON e fazem a busca em memória.
4. Faixas invertidas são **descartadas** e aparecem em `meta.faixasDescartadas`. Inverter as pontas criaria cobertura falsa: `45910-972 → 49910-000` cobriria boa parte de Sergipe.
5. Faixas sobrepostas são mantidas. A resposta lista **todas** as unidades que atendem o CEP em cada modalidade.
6. As respostas saem com `Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600`, ou seja, ficam 24 h em cache na CDN da Vercel. Como cada deploy invalida o cache da CDN, um snapshot novo aparece logo após a sincronização.

## Opções consideradas

### Opção A: buscar na planilha a cada requisição, com cache em memória

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Baixa |
| Custo | Baixo, mas cada *cold start* baixa 4 MB |
| Latência | 4 a 6 s no *cold start*, menos de 5 ms depois |
| Disponibilidade | Depende dos Correios em tempo real |
| Frescor | Máximo, limitado pelo TTL do cache |

**Prós:** sem pipeline de dados, o dado está sempre atual.
**Contras:** a latência no *cold start* é ruim. Se os Correios caírem, a API cai junto (502). Cada instância baixa a planilha de novo, o que gera carga repetida no site dos Correios. Não há histórico do que mudou.

### Opção B: snapshot JSON no repositório, atualizado por GitHub Action (**escolhida**)

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Baixa: um script e um workflow |
| Custo | Zero: Actions gratuito em repositório público, sem storage extra |
| Latência | Menos de 5 ms, inclusive no *cold start* (dado no bundle) |
| Disponibilidade | Independe dos Correios em tempo de requisição |
| Frescor | Até 24 h de atraso (configurável) |

**Prós:** a API nunca depende dos Correios para responder. O histórico de abrangência fica no `git log`, com diff do que mudou. É reprodutível e testável offline. Uma falha da sincronização só deixa o dado mais velho, não derruba a API.
**Contras:** o dado pode estar até um dia atrasado. O repositório ganha um JSON de ~1 a 2 MB que muda com o tempo. Cada mudança na planilha gera um deploy.

### Opção C: Vercel Cron, com o snapshot em Vercel Blob ou KV

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Média: storage, credenciais e leitura remota |
| Custo | Baixo, mas acoplado ao plano da Vercel |
| Latência | Uma leitura remota no *cold start* |
| Disponibilidade | Depende do Blob ou KV, não dos Correios |
| Frescor | Igual à B |

**Prós:** atualiza sem deploy e o repositório fica sem dados.
**Contras:** traz mais infraestrutura e segredos. Perde o histórico em git. O projeto fica preso à Vercel, e o Cron do plano Hobby tem limitações. Hoje não resolve nada que a B não resolva.

## Análise de trade-offs

A troca principal é **frescor contra disponibilidade**. A opção A dá o dado mais fresco, mas acopla nossa disponibilidade e nossa latência a um servidor lento e instável. Como a tabela muda pouco, um atraso de até 24 h é um preço baixo por uma API que responde em milissegundos e não cai quando os Correios caem.

Entre B e C, a C só compensaria se precisássemos atualizar sem deploy ou se o JSON fosse grande demais para o bundle. Nenhuma das duas coisas acontece: o JSON normalizado fica na casa de 1 a 2 MB, bem abaixo do limite de função da Vercel. A B é a opção mais simples que atende ao problema.

Busca: são cerca de 5.300 faixas por serviço, e uma varredura linear sobre arrays de inteiros leva microssegundos. Árvore de intervalos ou índice ficam para quando houver necessidade medida.

## Contrato da API (resumo)

| Método e rota | Descrição |
|---------------|-----------|
| `GET /api/v1/abrangencia/coleta/{cep}` | Abrangência do CEP por modalidade |
| `GET /api/v1/meta` | Data e hash do snapshot, totais, faixas descartadas |
| `GET /openapi.json` | Especificação OpenAPI 3.1 (arquivo estático) |
| `GET /docs` | Swagger UI |

Exemplo de resposta de `/api/v1/abrangencia/coleta/01310-100`:

```json
{
  "cep": "01310100",
  "cepFormatado": "01310-100",
  "atendido": true,
  "modalidades": {
    "sedexReverso": { "servico": "SEDEX Reverso", "aceito": true,
      "unidades": [{ "unidade": "CDD ...", "dr": "SE/SPM", "prazo": "D + 1", "prazoDias": 1,
                     "cepInicial": "01310-000", "cepFinal": "01310-999" }] },
    "pacReverso":   { "servico": "PAC Reverso",   "aceito": true,  "unidades": [ ] },
    "disqueColeta": { "servico": "Disque Coleta", "aceito": false, "unidades": [] }
  },
  "dados": { "atualizadoEm": "2026-10-19T14:45:10Z", "fonte": "https://www2.correios.com.br/..." }
}
```

Erros: `400` para CEP inválido (formato diferente de 8 dígitos, com ou sem hífen, ou `00000000`). Um CEP fora de qualquer faixa **não** é erro: retorna `200` com `aceito: false` em todas as modalidades.

Validação de localidade: a API valida o formato do CEP e se ele cai nas faixas da planilha. Ela **não** confirma se o CEP existe nos Correios, porque isso exigiria uma API externa, como ViaCEP, o que traria de volta a dependência em tempo real que este ADR evita. Isso pode ser adicionado depois como opcional.

## Consequências

- **Fica mais fácil:** responder rápido e com previsibilidade. Testar offline com o snapshot. Auditar mudanças de cobertura pelo histórico do git.
- **Fica mais difícil:** refletir mudanças dos Correios no mesmo dia. Exige rodar o workflow manualmente.
- **Revisitar se:** a planilha passar de cerca de 20 MB, precisarmos de frescor abaixo de uma hora, ou os Correios publicarem uma API oficial de abrangência.
- **Risco:** se os Correios mudarem o layout da planilha, a sincronização falha. Ela deve falhar **de forma explícita**, com o job vermelho e sem commit, e nunca gravar um snapshot vazio. A API continua servindo o último snapshot válido.

## Itens de ação

1. [x] Criar o projeto Next.js (App Router, TypeScript) com as rotas `/api/v1/abrangencia/coleta/[cep]`, `/api/v1/meta`, `/openapi.json` e a página `/docs`.
2. [x] Implementar `scripts/sync.ts` com as validações: cabeçalho esperado, mínimo de linhas e serviços conhecidos. Gerar o primeiro `data/abrangencia.json`.
3. [x] Escrever testes do parser e da busca (Vitest), com CEPs de borda, sobreposição e faixas descartadas.
4. [x] Criar o workflow `.github/workflows/sync.yml` (cron diário e `workflow_dispatch`, commit só quando houver mudança).
5. [x] Escrever a especificação OpenAPI e o README (uso, deploy na Vercel, como forçar a sincronização).
6. [ ] Se surgir necessidade: validação opcional de existência do CEP via ViaCEP.
