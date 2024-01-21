extern int cmdfd, iofd;

#define die(...) do { fprintf(stderr, __VA_ARGS__); exit(1); } while (0)

int ttynew(
	const char *termname,
	const char *line, char *cmd, const char *out, char **args);

void ttyhangup(void);
