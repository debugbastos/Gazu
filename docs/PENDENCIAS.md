# Pendências antes de vender — GAZU

O sistema está implementado e testado em ambiente de desenvolvimento. Os itens abaixo dependem do cliente ou de contas externas. Nenhum deles é simulado em produção: enquanto não forem resolvidos, a loja informa claramente que a função não está disponível.

## Dependem do cliente

| Item | Situação atual | Onde resolver |
|---|---|---|
| Preços reais | Preços ilustrativos (marcados “Demonstração”) | /admin/produtos |
| Estoque real | Estoque ilustrativo | /admin/produtos → Variantes → Ajustar estoque |
| Cores confirmadas | Descritas pela aparência da foto (“Cor descrita a partir da fotografia”) | /admin/produtos → marcar “Cores confirmadas” |
| Tamanhos por produto | Perfis genéricos (PP–GG, 2–12, 34–43, Único) | /admin/produtos → Variantes |
| Fotos adicionais por produto | 1 foto por produto | /admin/produtos → Imagens (a galeria passa a usá-las) |
| Fotos dos acessórios | Usadas as fotos de acessórios presentes no arquivo enviado (bonés, colares, pulseiras, relógios e kits com anéis); categoria Bolsas sem produtos | /admin/produtos |
| Direito de uso das imagens | Várias fotos exibem marcas de terceiros e uma tem marca d’água “Dola AI” — **confirmar origem, licença e autenticidade dos produtos** | — |
| Modelos do hero em alta resolução | Origem com 300–624 px de largura | substituir em `assets-source/hero/` e rodar `npm run images` |
| Fonte oficial da marca | Inter / Inter Display (provisória) | `src/client/styles/tokens.css` |
| Arquivos originais dos templates | Usadas as capturas de tela | enviar para refinamento fino |
| Razão social, CNPJ, endereço | Vazios (o site mostra aviso em vez de inventar) | /admin/configuracoes |
| E-mail, telefone, WhatsApp, horário | Vazios | /admin/configuracoes |
| Redes sociais | Vazias (links não aparecem) | /admin/configuracoes |
| Política comercial de trocas (além dos 7 dias legais) | Texto-base com aviso de pendência | `src/client/pages/Static.tsx` |
| Revisão jurídica (privacidade, termos) | Textos-base | `src/client/pages/Static.tsx` |
| Mensagem da barra de anúncio | “Nova coleção GAZU — conheça as novidades” (não promete frete grátis/descontos) | /admin/configuracoes |
| Cupom de demonstração `BEMVINDO10` | Ativo e marcado como demo | /admin/cupons (desativar ou ajustar) |

## Dependem de contas/integrações externas

| Integração | O que falta | Referência |
|---|---|---|
| Mercado Pago (Pix e cartão) | Conta, credenciais de teste → produção, métodos aprovados, webhook com assinatura | README §8–9 |
| Webhook em HTTPS | Domínio público com HTTPS | README §9 |
| Login com Google | Projeto no Google Cloud e credenciais OAuth | README §7 |
| Frete | Regras manuais no painel **ou** contrato com transportadora/agregador (integração não implementada) | README §10 |
| E-mail transacional | Conta Resend (ou equivalente) e domínio verificado | README §11 |
| Hospedagem | Servidor Node 22 com disco persistente e backup | README §13 |
| Cartão de débito | Não implementado (depende da modalidade aprovada na conta) | — |
| Parcelamento | Controlado por `MP_MAX_INSTALLMENTS`; juros/condições vêm do provedor | — |

## Limitações conhecidas

- Verificação TypeScript completa do front-end requer `npm install` (os tipos `@types/react` não estavam disponíveis no ambiente desta entrega; o servidor foi verificado em modo estrito e o cliente com tipos simplificados — ver relatório de testes).
- Limitador de tentativas é em memória (adequado para uma instância). Em múltiplas instâncias, mover para Redis.
- Busca usa `LIKE` normalizado (sem acento). Para catálogos grandes, considerar FTS5/Postgres full-text.
